import { describe, it, expect, vi } from 'vitest';
import type { GitClient, RepoRef } from '@devdigest/shared';
import { MockTokenizer } from '../src/adapters/mocks.js';
import { RunBus } from '../src/platform/sse.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { ReviewRunExecutor, type ReviewRunDeps } from '../src/modules/reviews/run-executor.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { AgentsRepository, AgentRow } from '../src/modules/agents/repository.js';
import type { SkillsRepository, SkillRow } from '../src/modules/skills/repository.js';
import type {
  ProjectContextRepository,
  AgentContextDocsView,
} from '../src/modules/project-context/repository.js';
import { MAX_DOC_CHARS, MAX_CONTEXT_BLOCK_TOKENS } from '../src/modules/project-context/constants.js';

/**
 * `ReviewRunExecutor#buildProjectContext` — order/dedup (AC-25/AC-26/AC-42),
 * truncation (AC-33), token budget (AC-34), and determinism (NFR-8). Exercised
 * against a `MockTokenizer` (deterministic `ceil(len/4)`) and a hand-rolled
 * `GitClient` stub — no DB, no HTTP; the private method is reached through a
 * cast, same pattern as `project-context-service.test.ts`.
 */

const WORKSPACE_ID = 'ws-1';

function buildAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: WORKSPACE_ID,
    name: 'Reviewer',
    description: '',
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'Review the diff.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as AgentRow;
}

function buildRepoRow() {
  return { owner: 'acme', name: 'payments-api' };
}

function buildGit(files: Record<string, string | Error>): GitClient {
  return {
    clonePathFor: () => '/mock/clones/acme/payments-api',
    clone: async () => ({ path: '/mock/clones/acme/payments-api' }),
    fetchPullHead: async () => undefined,
    sync: async () => ({ head: 'deadbeef' }),
    currentHead: async () => 'deadbeef',
    diffNameOnly: async () => [],
    diff: async () => ({ files: [] }) as never,
    blame: async () => [],
    log: async () => [],
    readFile: async (_repo: RepoRef, path: string) => {
      const v = files[path];
      if (v instanceof Error) throw v;
      return v ?? '';
    },
    listFiles: async () => ({ paths: [], truncated: false }),
    dirtyPaths: async () => [],
    writeFile: async () => undefined,
  };
}

function buildContextRepo(view: AgentContextDocsView): ProjectContextRepository {
  return {
    listForAgentWithSkills: vi.fn(async () => view),
  } as unknown as ProjectContextRepository;
}

function buildThrowingContextRepo(message: string): ProjectContextRepository {
  return {
    listForAgentWithSkills: vi.fn(async () => {
      throw new Error(message);
    }),
  } as unknown as ProjectContextRepository;
}

function buildSkillsRepo(byAgent: Map<string, SkillRow[]> = new Map()): SkillsRepository {
  return {
    skillsForAgents: vi.fn(async () => byAgent),
  } as unknown as SkillsRepository;
}

function skillRow(id: string, name: string): SkillRow {
  return { id, name } as unknown as SkillRow;
}

function buildExecutor(deps: {
  contextRepo: ProjectContextRepository;
  git: GitClient;
  tokenizer?: MockTokenizer;
  skillsRepo?: SkillsRepository;
}) {
  const runBus = new RunBus();
  const reviewDeps = {
    git: deps.git,
    runBus,
    repoIntel: {} as never,
    llm: async () => ({}) as never,
    skillsRepo: deps.skillsRepo ?? buildSkillsRepo(),
    contextRepo: deps.contextRepo,
    tokenizer: deps.tokenizer ?? new MockTokenizer(),
    github: async () => ({}) as never,
    intentModel: async () => ({}) as never,
    httpFetcher: {} as never,
    linkAllowlist: async () => [],
  } as unknown as ReviewRunDeps;

  const executor = new ReviewRunExecutor(
    reviewDeps,
    {} as unknown as ReviewRepository,
    {} as unknown as AgentsRepository,
  );
  const runLog = new RunLogger(runBus, ['run-1']);
  return { executor, runLog };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callBuildProjectContext(executor: any, agent: AgentRow, runLog: RunLogger) {
  return executor.buildProjectContext(agent, WORKSPACE_ID, buildRepoRow(), runLog) as Promise<{
    specs?: string[];
    specsRead: { path: string; tokens: number; status: string; origin: string; skill_name?: string | null }[];
    readerError?: string;
  }>;
}

describe('buildProjectContext — order, dedup, truncation, budget, determinism', () => {
  it('reads the agent\'s own attachments before inherited ones, in persisted order (AC-25)', async () => {
    const view: AgentContextDocsView = {
      agent: [
        { path: 'docs/b.md', order: 0 },
        { path: 'docs/a.md', order: 1 },
      ],
      inherited: [{ path: 'skills/z.md', order: 0, skillId: 'skill-1' }],
    };
    const git = buildGit({ 'docs/b.md': 'B', 'docs/a.md': 'A', 'skills/z.md': 'Z' });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specs).toEqual(['B', 'A', 'Z']);
    expect(result.specsRead.map((r) => r.path)).toEqual(['docs/b.md', 'docs/a.md', 'skills/z.md']);
    expect(result.specsRead[0]!.origin).toBe('agent');
    expect(result.specsRead[2]!.origin).toBe('skill');
  });

  it('deduplicates a path attached to the agent AND one of its skills — first position wins (AC-26)', async () => {
    const view: AgentContextDocsView = {
      agent: [{ path: 'docs/shared.md', order: 0 }],
      inherited: [{ path: 'docs/shared.md', order: 0, skillId: 'skill-1' }],
    };
    const git = buildGit({ 'docs/shared.md': 'AGENT-VERSION' });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specsRead).toHaveLength(1);
    expect(result.specsRead[0]!.origin).toBe('agent');
  });

  it('deduplicates a path inherited from two different skills — first (by skill link order) wins (AC-42)', async () => {
    const view: AgentContextDocsView = {
      agent: [],
      inherited: [
        { path: 'docs/shared.md', order: 0, skillId: 'skill-first' },
        { path: 'docs/shared.md', order: 0, skillId: 'skill-second' },
      ],
    };
    const git = buildGit({ 'docs/shared.md': 'X' });
    const skillsRepo = buildSkillsRepo(
      new Map([['agent-1', [skillRow('skill-first', 'First Skill'), skillRow('skill-second', 'Second Skill')]]]),
    );
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git, skillsRepo });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specsRead).toHaveLength(1);
    expect(result.specsRead[0]!.skill_name).toBe('First Skill');
  });

  it('truncates a document over MAX_DOC_CHARS, with the marker visible inside the (later-wrapped) raw text (AC-33)', async () => {
    const big = 'x'.repeat(MAX_DOC_CHARS + 500);
    const view: AgentContextDocsView = {
      agent: [{ path: 'docs/huge.md', order: 0 }],
      inherited: [],
    };
    const git = buildGit({ 'docs/huge.md': big });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specsRead[0]!.status).toBe('truncated');
    expect(result.specs![0]!.length).toBeLessThan(big.length);
    expect(result.specs![0]).toContain('truncated');
    expect(result.specs![0]!.startsWith('x'.repeat(MAX_DOC_CHARS))).toBe(true);
  });

  it('drops WHOLE documents from the tail once the token budget is exceeded, never a partial document (AC-34)', async () => {
    // MockTokenizer: ceil(len/4). Two docs each ~ MAX_CONTEXT_BLOCK_TOKENS/2 + margin
    // push the running total over budget on the second one.
    const perDocChars = Math.ceil((MAX_CONTEXT_BLOCK_TOKENS / 2 + 100) * 4);
    const docA = 'a'.repeat(perDocChars);
    const docB = 'b'.repeat(perDocChars);
    const docC = 'c'.repeat(10);
    const view: AgentContextDocsView = {
      agent: [
        { path: 'docs/a.md', order: 0 },
        { path: 'docs/b.md', order: 1 },
        { path: 'docs/c.md', order: 2 },
      ],
      inherited: [],
    };
    const git = buildGit({ 'docs/a.md': docA, 'docs/b.md': docB, 'docs/c.md': docC });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specsRead.find((r) => r.path === 'docs/a.md')!.status).toBe('injected');
    expect(result.specsRead.find((r) => r.path === 'docs/b.md')!.status).toBe('dropped_budget');
    expect(result.specsRead.find((r) => r.path === 'docs/c.md')!.status).toBe('dropped_budget');
    // Dropped documents never appear (whole, or partial) in `specs`.
    expect(result.specs).toEqual([docA]);
  });

  it('is deterministic — the same attachment set/order produces a byte-identical specs array across two runs (NFR-8)', async () => {
    const view: AgentContextDocsView = {
      agent: [
        { path: 'docs/b.md', order: 0 },
        { path: 'docs/a.md', order: 1 },
      ],
      inherited: [{ path: 'skills/z.md', order: 0, skillId: 'skill-1' }],
    };
    const files = { 'docs/b.md': 'B content', 'docs/a.md': 'A content', 'skills/z.md': 'Z content' };

    const run1 = await callBuildProjectContext(
      buildExecutor({ contextRepo: buildContextRepo(view), git: buildGit(files) }).executor,
      buildAgent(),
      buildExecutor({ contextRepo: buildContextRepo(view), git: buildGit(files) }).runLog,
    );
    const run2 = await callBuildProjectContext(
      buildExecutor({ contextRepo: buildContextRepo(view), git: buildGit(files) }).executor,
      buildAgent(),
      buildExecutor({ contextRepo: buildContextRepo(view), git: buildGit(files) }).runLog,
    );

    expect(run1.specs).toEqual(run2.specs);
    expect(JSON.stringify(run1.specsRead)).toBe(JSON.stringify(run2.specsRead));
  });
});

describe('buildProjectContext — missing documents and reader failure (AC-35, AC-36, NFR-6)', () => {
  it('a document that THROWS on read is treated as missing, same as an empty-string read (AC-36)', async () => {
    const view: AgentContextDocsView = {
      agent: [{ path: 'docs/broken.md', order: 0 }],
      inherited: [],
    };
    const git = buildGit({ 'docs/broken.md': new Error('ENOENT: no such file') });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specs).toBeUndefined();
    expect(result.specsRead).toEqual([
      { path: 'docs/broken.md', tokens: 0, status: 'missing', origin: 'agent', skill_name: null },
    ]);
  });

  it('a document that reads as "" (empty string) is treated as missing, same as a throw (AC-36)', async () => {
    const view: AgentContextDocsView = {
      agent: [{ path: 'docs/empty.md', order: 0 }],
      inherited: [],
    };
    const git = buildGit({ 'docs/empty.md': '' });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specsRead).toEqual([
      { path: 'docs/empty.md', tokens: 0, status: 'missing', origin: 'agent', skill_name: null },
    ]);
  });

  it('one unreadable document among several only drops that one — the run is not affected (AC-35)', async () => {
    const view: AgentContextDocsView = {
      agent: [
        { path: 'docs/ok.md', order: 0 },
        { path: 'docs/missing.md', order: 1 },
      ],
      inherited: [],
    };
    const git = buildGit({ 'docs/ok.md': 'fine', 'docs/missing.md': new Error('gone') });
    const { executor, runLog } = buildExecutor({ contextRepo: buildContextRepo(view), git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specs).toEqual(['fine']);
    expect(result.specsRead.map((r) => r.status)).toEqual(['injected', 'missing']);
  });

  it('a total reader failure (listForAgentWithSkills throws) degrades to an empty set with the cause recorded — the run is not failed (NFR-6)', async () => {
    const contextRepo = buildThrowingContextRepo('connection reset');
    const git = buildGit({});
    const { executor, runLog } = buildExecutor({ contextRepo, git });
    const result = await callBuildProjectContext(executor, buildAgent(), runLog);

    expect(result.specs).toBeUndefined();
    expect(result.specsRead).toEqual([]);
    expect(result.readerError).toBe('connection reset');
  });
});
