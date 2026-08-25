import { describe, it, expect, vi } from 'vitest';
import type { GitClient } from '@devdigest/shared';
import { MockGitClient, MockTokenizer } from '../src/adapters/mocks.js';
import { ProjectContextService, type ProjectContextDeps } from '../src/modules/project-context/service.js';
import type { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import type { RepoRepository, RepoRow } from '../src/modules/repos/repository.js';
import { ValidationError, NotFoundError } from '../src/platform/errors.js';

/**
 * `ProjectContextService` orchestration, against `MockGitClient` /
 * `MockTokenizer` (never the real adapters/db). AC-36 is exercised BOTH ways —
 * a GitClient that throws and one that returns '' — because a check that only
 * handles one shape passes on the mock and breaks against the real client.
 */

const WORKSPACE_ID = 'ws-1';
const REPO_ID = 'repo-1';

/**
 * `MockGitClient`'s methods live on its prototype, so `{ ...instance, x: fn }`
 * silently drops every un-overridden method (object spread only copies OWN
 * enumerable properties). Bind the base instance's methods explicitly instead
 * of relying on spread.
 */
function partialGit(base: MockGitClient, overrides: Partial<GitClient>): GitClient {
  return {
    clonePathFor: base.clonePathFor.bind(base),
    clone: base.clone.bind(base),
    fetchPullHead: base.fetchPullHead.bind(base),
    sync: base.sync.bind(base),
    currentHead: base.currentHead.bind(base),
    diffNameOnly: base.diffNameOnly.bind(base),
    diff: base.diff.bind(base),
    blame: base.blame.bind(base),
    log: base.log.bind(base),
    readFile: base.readFile.bind(base),
    listFiles: base.listFiles.bind(base),
    dirtyPaths: base.dirtyPaths.bind(base),
    writeFile: base.writeFile.bind(base),
    ...overrides,
  };
}

function buildRepoRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: REPO_ID,
    workspaceId: WORKSPACE_ID,
    owner: 'acme',
    name: 'payments-api',
    fullName: 'acme/payments-api',
    clonePath: '/mock/clones/acme/payments-api',
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as RepoRow;
}

function buildRepoRepo(overrides: Partial<RepoRepository> = {}): RepoRepository {
  return {
    getById: vi.fn(async () => buildRepoRow()),
    ...overrides,
  } as unknown as RepoRepository;
}

function buildProjectContextRepo(overrides: Partial<ProjectContextRepository> = {}): ProjectContextRepository {
  return {
    listForAgent: vi.fn(async () => []),
    listForSkill: vi.fn(async () => []),
    setForAgent: vi.fn(async () => undefined),
    setForSkill: vi.fn(async () => undefined),
    attachmentCountsByPath: vi.fn(async () => new Map<string, number>()),
    listForAgentWithSkills: vi.fn(async () => ({ agent: [], inherited: [] })),
    ...overrides,
  } as unknown as ProjectContextRepository;
}

function buildService(overrides: Partial<ProjectContextDeps> = {}): ProjectContextService {
  const deps: ProjectContextDeps = {
    git: overrides.git ?? new MockGitClient({ files: { 'specs/a.md': 'hello world' } }),
    tokenizer: overrides.tokenizer ?? new MockTokenizer(),
    contextRoots: overrides.contextRoots ?? (async () => ['specs/', 'docs/']),
    repoRepo: overrides.repoRepo ?? buildRepoRepo(),
    repo: overrides.repo ?? buildProjectContextRepo(),
  };
  return new ProjectContextService(deps);
}

describe('ProjectContextService.listDocuments', () => {
  it('no clone → cloned:false, count/tokenSum OMITTED (AC-6, AC-63)', async () => {
    const repoRepo = buildRepoRepo({
      getById: vi.fn(async () => buildRepoRow({ clonePath: null })),
    });
    const service = buildService({ repoRepo });
    const listing = await service.listDocuments(WORKSPACE_ID, REPO_ID);
    expect(listing.status.cloned).toBe(false);
    expect(listing.status.count).toBeUndefined();
    expect(listing.status.tokenSum).toBeUndefined();
    expect(listing.docs).toEqual([]);
  });

  it('empty roots match → empty listing, status states zero (AC-5, AC-62)', async () => {
    const git = new MockGitClient({ files: {} });
    const service = buildService({ git });
    const listing = await service.listDocuments(WORKSPACE_ID, REPO_ID);
    expect(listing.docs).toEqual([]);
    expect(listing.status.count).toBe(0);
    expect(listing.status.tokenSum).toBe(0);
  });

  it('lists documents under configured roots, enriched with attachment counts (AC-1, AC-14)', async () => {
    const git = new MockGitClient({
      files: { 'specs/a.md': 'hello world', 'docs/b.md': 'more text', 'src/index.ts': 'ignored' },
    });
    const counts = new Map([['specs/a.md', 3]]);
    const repo = buildProjectContextRepo({ attachmentCountsByPath: vi.fn(async () => counts) });
    const service = buildService({ git, repo });

    const listing = await service.listDocuments(WORKSPACE_ID, REPO_ID);
    expect(listing.docs.map((d) => d.path).sort()).toEqual(['docs/b.md', 'specs/a.md']);
    const a = listing.docs.find((d) => d.path === 'specs/a.md')!;
    expect(a.attachedCount).toBe(3);
    expect(a.root).toBe('specs/');
  });

  it('git.listFiles throwing propagates — never degrades to an empty successful list (NFR-7)', async () => {
    const git = partialGit(new MockGitClient(), {
      listFiles: vi.fn(async () => {
        throw new Error('clone unreadable');
      }),
    });
    const service = buildService({ git });
    await expect(service.listDocuments(WORKSPACE_ID, REPO_ID)).rejects.toThrow('clone unreadable');
  });

  it('throws NotFoundError for an unknown repo', async () => {
    const repoRepo = buildRepoRepo({ getById: vi.fn(async () => undefined) });
    const service = buildService({ repoRepo });
    await expect(service.listDocuments(WORKSPACE_ID, REPO_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a fast token sum is NOT pending (control case)', async () => {
    const git = new MockGitClient({ files: { 'specs/a.md': 'hello world' } });
    const service = buildService({ git });
    const listing = await service.listDocuments(WORKSPACE_ID, REPO_ID);
    expect(listing.status.pending).toBe(false);
    expect(listing.status.tokenSum).toBe(Math.ceil('hello world'.length / 4));
  });

  it('a token sum that never resolves before the deadline degrades to pending:true, tokenSum:null (AC-61, NFR-21)', async () => {
    // A GitClient whose readFile hangs forever — the sum's per-file read never
    // settles, so the race must be won by the SUM_ESTIMATE_BUDGET_MS timer.
    const git = partialGit(new MockGitClient({ files: { 'specs/a.md': 'hello world' } }), {
      readFile: vi.fn(() => new Promise<string>(() => {})),
    });
    const service = buildService({ git });
    vi.useFakeTimers();
    try {
      const promise = service.listDocuments(WORKSPACE_ID, REPO_ID);
      await vi.advanceTimersByTimeAsync(3_100);
      const listing = await promise;
      expect(listing.status.pending).toBe(true);
      expect(listing.status.tokenSum).toBeNull();
      // The listing itself is NOT blocked — docs are still returned.
      expect(listing.docs.map((d) => d.path)).toEqual(['specs/a.md']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ProjectContextService.readDocument — AC-36 (throw AND empty string both = missing)', () => {
  it('a GitClient that THROWS on a missing path resolves to null', async () => {
    const git = partialGit(new MockGitClient(), {
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
      dirtyPaths: vi.fn(async () => []),
    });
    const service = buildService({ git });
    const result = await service.readDocument(WORKSPACE_ID, REPO_ID, 'specs/missing.md');
    expect(result).toBeNull();
  });

  it('a GitClient that returns EMPTY STRING (MockGitClient default) resolves to null', async () => {
    const git = new MockGitClient({ files: {} }); // readFile('specs/missing.md') -> ''
    const service = buildService({ git });
    const result = await service.readDocument(WORKSPACE_ID, REPO_ID, 'specs/missing.md');
    expect(result).toBeNull();
  });

  it('a readable document returns content + token estimate + fallback flag (AC-15/AC-18)', async () => {
    const git = new MockGitClient({ files: { 'specs/a.md': 'hello world' } });
    const tokenizer = new MockTokenizer(true); // approximate fallback active
    const service = buildService({ git, tokenizer });
    const result = await service.readDocument(WORKSPACE_ID, REPO_ID, 'specs/a.md');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('hello world');
    expect(result!.approximate).toBe(true);
    expect(result!.tokens).toBe(Math.ceil('hello world'.length / 4));
  });

  it('containment guard rejects a traversal path before touching git (AC-47/NFR-18)', async () => {
    const base = new MockGitClient({ files: {} });
    const readFile = vi.fn(base.readFile.bind(base));
    const git = partialGit(base, { readFile });
    const service = buildService({ git });
    const result = await service.readDocument(WORKSPACE_ID, REPO_ID, '../etc/passwd');
    expect(result).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('dirty flag reflects git.dirtyPaths for that exact path (AC-21)', async () => {
    const git = new MockGitClient({ files: { 'specs/a.md': 'hello' }, dirty: ['specs/a.md'] });
    const service = buildService({ git });
    const result = await service.readDocument(WORKSPACE_ID, REPO_ID, 'specs/a.md');
    expect(result!.dirty).toBe(true);
  });
});

describe('ProjectContextService.writeDocument', () => {
  it('writes without committing and reports ok:true', async () => {
    const git = new MockGitClient({ files: {} });
    const service = buildService({ git });
    const result = await service.writeDocument(WORKSPACE_ID, REPO_ID, 'specs/a.md', 'new text');
    expect(result).toEqual({ ok: true });
    expect(await git.readFile({} as never, 'specs/a.md')).toBe('new text');
  });

  it('a failed write leaves the file untouched and reports the reason (AC-23/AC-55)', async () => {
    const base = new MockGitClient({ files: { 'specs/a.md': 'original' } });
    const git = partialGit(base, {
      writeFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const service = buildService({ git });
    const result = await service.writeDocument(WORKSPACE_ID, REPO_ID, 'specs/a.md', 'new text');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('disk full');
    expect(await base.readFile({} as never, 'specs/a.md')).toBe('original');
  });

  it('rejects a traversal path before touching git', async () => {
    const base = new MockGitClient({ files: {} });
    const writeFile = vi.fn(base.writeFile.bind(base));
    const git = partialGit(base, { writeFile });
    const service = buildService({ git });
    const result = await service.writeDocument(WORKSPACE_ID, REPO_ID, '../etc/passwd', 'x');
    expect(result.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('ProjectContextService.dirtyDocuments', () => {
  it('narrows dirty paths to *.md under the configured roots (AC-21/AC-66)', async () => {
    const git = new MockGitClient({
      dirty: ['specs/a.md', 'specs/notes.txt', 'docs/b.md', 'src/index.ts'],
    });
    const service = buildService({ git });
    const dirty = await service.dirtyDocuments(WORKSPACE_ID, REPO_ID);
    expect(dirty.sort()).toEqual(['docs/b.md', 'specs/a.md']);
  });
});

describe('ProjectContextService.agentAttachments / skillAttachments — missing (AC-37)', () => {
  it('without a repoId, every attachment reports missing:false (no clone to check against)', async () => {
    const repo = buildProjectContextRepo({
      listForAgent: vi.fn(async () => [{ path: 'specs/gone.md', order: 0 }]),
    });
    const service = buildService({ repo });
    const rows = await service.agentAttachments(WORKSPACE_ID, 'agent-1');
    expect(rows).toEqual([{ path: 'specs/gone.md', order: 0, missing: false }]);
  });

  it('with a repoId, a path absent from that repo clone is reported missing:true, never dropped', async () => {
    const git = new MockGitClient({ files: { 'specs/present.md': 'hello' } });
    const repo = buildProjectContextRepo({
      listForAgent: vi.fn(async () => [
        { path: 'specs/present.md', order: 0 },
        { path: 'specs/gone.md', order: 1 },
      ]),
    });
    const service = buildService({ git, repo });
    const rows = await service.agentAttachments(WORKSPACE_ID, 'agent-1', REPO_ID);
    expect(rows).toEqual([
      { path: 'specs/present.md', order: 0, missing: false },
      { path: 'specs/gone.md', order: 1, missing: true },
    ]);
  });

  it('a GitClient that THROWS for a path also counts as missing:true (AC-36-style tolerance)', async () => {
    const base = new MockGitClient({ files: {} });
    const git = partialGit(base, {
      readFile: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
    });
    const repo = buildProjectContextRepo({
      listForSkill: vi.fn(async () => [{ path: 'specs/thrown.md', order: 0 }]),
    });
    const service = buildService({ git, repo });
    const rows = await service.skillAttachments(WORKSPACE_ID, 'skill-1', REPO_ID);
    expect(rows).toEqual([{ path: 'specs/thrown.md', order: 0, missing: true }]);
  });

  it('an unresolvable repo id degrades the whole batch to missing:false rather than throwing', async () => {
    const repoRepo = buildRepoRepo({ getById: vi.fn(async () => undefined) });
    const repo = buildProjectContextRepo({
      listForAgent: vi.fn(async () => [{ path: 'specs/x.md', order: 0 }]),
    });
    const service = buildService({ repoRepo, repo });
    const rows = await service.agentAttachments(WORKSPACE_ID, 'agent-1', 'nonexistent-repo');
    expect(rows).toEqual([{ path: 'specs/x.md', order: 0, missing: false }]);
  });
});

describe('ProjectContextService.setAgentDocs / setSkillDocs — the 20-doc limit (AC-12/NFR-3)', () => {
  it('accepts exactly 20 documents', async () => {
    const repo = buildProjectContextRepo();
    const service = buildService({ repo });
    const paths = Array.from({ length: 20 }, (_, i) => `specs/${i}.md`);
    await expect(service.setAgentDocs(WORKSPACE_ID, 'agent-1', paths)).resolves.toBeDefined();
    expect(repo.setForAgent).toHaveBeenCalledWith(WORKSPACE_ID, 'agent-1', paths);
  });

  it('rejects a 21st document with a ValidationError stating the limit', async () => {
    const repo = buildProjectContextRepo();
    const service = buildService({ repo });
    const paths = Array.from({ length: 21 }, (_, i) => `specs/${i}.md`);
    await expect(service.setAgentDocs(WORKSPACE_ID, 'agent-1', paths)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.setAgentDocs(WORKSPACE_ID, 'agent-1', paths)).rejects.toThrow('20');
    expect(repo.setForAgent).not.toHaveBeenCalled();
  });

  it('rejects a path that escapes containment before writing', async () => {
    const repo = buildProjectContextRepo();
    const service = buildService({ repo });
    await expect(
      service.setSkillDocs(WORKSPACE_ID, 'skill-1', ['../etc/passwd']),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.setForSkill).not.toHaveBeenCalled();
  });
});

describe('ProjectContextService.estimateTokens', () => {
  it('never caches — two calls over the same text both hit the tokenizer (AC-19)', () => {
    const count = vi.fn(() => 5);
    const tokenizer = { approximate: false, count };
    const service = buildService({ tokenizer });
    service.estimateTokens('same text');
    service.estimateTokens('same text');
    expect(count).toHaveBeenCalledTimes(2);
  });
});
