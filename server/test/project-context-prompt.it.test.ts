import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';
import { MAX_DOC_CHARS } from '../src/modules/project-context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-prompt] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 100,
  findings: [],
};

/**
 * `0001b` — attached project-context documents actually reach the review
 * prompt (via `run-executor.ts#buildProjectContext`) and the run trace.
 * Follows `skills-in-prompt.it.test.ts`'s shape as the closest precedent for
 * asserting on the ASSEMBLED prompt/trace rather than the repository alone
 * (that side is covered by `project-context.it.test.ts`).
 */
d('project-context documents reach the review prompt (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(files: Record<string, string> = {}) {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, files }),
        llm: { openai: llm },
      },
    });
    return { app, llm };
  }

  async function setupRepoAndPr(db: PgFixture['handle']['db']) {
    const name = `context-prompt-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900 + repoSeq,
        title: 'Some change',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: null,
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>['app'], name: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.', ...extra },
    });
    return res.json().id as string;
  }

  async function runAndGetTrace(app: Awaited<ReturnType<typeof appWith>>['app'], pr: { id: string }, agentId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1, timeoutMs: 30_000 });
    return (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
  }

  it('an agent with an attached document gets "## Project context" in the prompt, and specs_read carries path/tokens/status/origin (AC-27, AC-38…AC-40, AC-56)', async () => {
    const { app } = await appWith({ 'specs/api.md': 'The API must be versioned.' });
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'Context Reviewer');

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentId, ['specs/api.md']);

    const trace = await runAndGetTrace(app, pr, agentId);

    expect(trace.prompt_assembly.user).toContain('## Project context');
    expect(trace.prompt_assembly.user).toContain('The API must be versioned.');
    expect(trace.prompt_assembly.user).toMatch(/<untrusted source="spec-0">/);

    expect(trace.specs_read).toHaveLength(1);
    expect(trace.specs_read[0]).toMatchObject({
      path: 'specs/api.md',
      status: 'injected',
      origin: 'agent',
    });
    expect(trace.specs_read[0].tokens).toBeGreaterThan(0);
    await app.close();
  });

  it('an agent with no attachments gets no "## Project context" section and an empty specs_read (AC-28)', async () => {
    const { app } = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'No Context Reviewer');

    const trace = await runAndGetTrace(app, pr, agentId);

    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    await app.close();
  });

  it('repo_intel: false does not suppress project-context documents (AC-30)', async () => {
    const { app } = await appWith({ 'specs/api.md': 'Independent of repo intel.' });
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'RepoIntel Off Reviewer', { repo_intel: false });

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentId, ['specs/api.md']);

    const trace = await runAndGetTrace(app, pr, agentId);

    expect(trace.prompt_assembly.user).toContain('## Project context');
    expect(trace.specs_read).toHaveLength(1);
    await app.close();
  });

  it('a disabled linked skill does not contribute its documents (AC-29)', async () => {
    const { app } = await appWith({ 'docs/from-disabled.md': 'Should never be injected.' });
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'Disabled Skill Reviewer');

    const skillsRepo = new SkillsRepository(pg.handle.db);
    const agentsRepo = new AgentsRepository(pg.handle.db);
    const contextRepo = new ProjectContextRepository(pg.handle.db);

    const skill = await skillsRepo.insert({
      workspaceId,
      name: 'Disabled Context Skill',
      description: 'x',
      type: 'custom',
      source: 'manual',
      body: 'irrelevant',
      enabled: false,
    });
    await contextRepo.setForSkill(workspaceId, skill.id, ['docs/from-disabled.md']);
    await agentsRepo.linkSkill(agentId, skill.id, 0);

    const trace = await runAndGetTrace(app, pr, agentId);

    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    await app.close();
  });

  it('makes exactly ONE completeStructured call — attachments never add a model call (AC-32)', async () => {
    const { app, llm } = await appWith({ 'specs/api.md': 'Some spec text.' });
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'One Call Reviewer');

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentId, ['specs/api.md']);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1, timeoutMs: 30_000 });

    // AC-32: attaching documents must add NO model call. The review itself is
    // the single `completeStructured`; anything more would mean the context
    // path called the model to select, summarise or rank documents.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    await app.close();
  });

  it('AC-36 (empty-content form) — MockGitClient.readFile returning "" is treated as missing, run stays successful', async () => {
    const { app } = await appWith({}); // no files map entry for the attached path
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'Missing Doc Reviewer (empty)');

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentId, ['specs/missing.md']);

    const trace = await runAndGetTrace(app, pr, agentId);

    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toHaveLength(1);
    expect(trace.specs_read[0]).toMatchObject({ path: 'specs/missing.md', status: 'missing', tokens: 0 });
    await app.close();
  });

  it('AC-36 (throwing form) — a readFile that REJECTS is treated as missing too, run stays successful', async () => {
    // The stock MockGitClient never throws: `readFile` resolves to '' for any
    // unmapped path (mocks.ts). SimpleGitClient, the real one, REJECTS on a
    // missing file. A test built only on the mock's empty-string shape would
    // pass while the real client fails the run — which is exactly why AC-36
    // demands both forms. Inject a git client whose readFile rejects.
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const throwingGit = new MockGitClient({ diff: DIFF, files: {} });
    throwingGit.readFile = async (_repo, path) => {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    };
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: throwingGit, llm: { openai: llm } },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agentId = await createAgent(app, 'Missing Doc Reviewer (throws)');

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentId, ['specs/explodes.md']);

    const trace = await runAndGetTrace(app, pr, agentId);

    // Same outcome as the empty-string form: skipped, run completes, recorded.
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toHaveLength(1);
    expect(trace.specs_read[0]).toMatchObject({ path: 'specs/explodes.md', status: 'missing', tokens: 0 });
    await app.close();
  });
});
