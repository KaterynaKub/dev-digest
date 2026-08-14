import { describe, it, expect, vi } from 'vitest';
import { BlastService, type BlastDeps } from '../src/modules/blast/service.js';
import type { BlastRepository } from '../src/modules/blast/repository.js';
import type { RepoIntel, BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { NotFoundError } from '../src/platform/errors.js';

/**
 * 0007 — service orchestration, with a mock repoIntel port (never the real
 * facade/adapters/db). Mirrors specs/0007-blast-radius.md §5 "service.test.ts".
 */

const WORKSPACE_ID = 'ws-1';
const PR_ID = 'pr-1';
const REPO_ID = 'repo-1';

function buildRepo(overrides: Partial<BlastRepository> = {}): BlastRepository {
  return {
    getPull: vi.fn(async () => ({ id: PR_ID, repoId: REPO_ID, workspaceId: WORKSPACE_ID }) as never),
    getPrFiles: vi.fn(async () => ['a.ts']),
    ...overrides,
  } as unknown as BlastRepository;
}

function buildRepoIntel(overrides: Partial<RepoIntel> = {}): RepoIntel {
  return {
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getIndexState: vi.fn(async () => ({ status: 'full' }) as IndexState),
    getBlastRadius: vi.fn(
      async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false }) as BlastResult,
    ),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
    ...overrides,
  } as unknown as RepoIntel;
}

function buildService(deps: Partial<BlastDeps> = {}): BlastService {
  return new BlastService({
    repo: deps.repo ?? buildRepo(),
    repoIntel: deps.repoIntel ?? buildRepoIntel(),
  });
}

describe('BlastService.forPull', () => {
  it('throws NotFoundError for an unknown prId', async () => {
    const service = buildService({ repo: buildRepo({ getPull: vi.fn(async () => undefined) }) });
    await expect(service.forPull(WORKSPACE_ID, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a PR with no changed files → degraded:false, index_status:full, repoIntel never called', async () => {
    const getBlastRadius = vi.fn();
    const getIndexState = vi.fn();
    const service = buildService({
      repo: buildRepo({ getPrFiles: vi.fn(async () => []) }),
      repoIntel: buildRepoIntel({ getBlastRadius, getIndexState }),
    });

    const result = await service.forPull(WORKSPACE_ID, PR_ID);

    expect(result.index_status).toBe('full');
    expect(result.degraded).toBe(false);
    expect(result.downstream).toEqual([]);
    expect(getBlastRadius).not.toHaveBeenCalled();
    expect(getIndexState).not.toHaveBeenCalled();
  });

  it('getBlastRadius throws → index_status:failed, degraded:true, reason:index_failed (never propagates, never 500)', async () => {
    const service = buildService({
      repoIntel: buildRepoIntel({
        getBlastRadius: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    });

    const result = await service.forPull(WORKSPACE_ID, PR_ID);

    expect(result.index_status).toBe('failed');
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('index_failed');
  });

  it('getIndexState throws but getBlastRadius succeeds → result is still returned, index_status not invented as full', async () => {
    const service = buildService({
      repoIntel: buildRepoIntel({
        getBlastRadius: vi.fn(
          async () =>
            ({
              changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
              callers: [],
              impactedEndpoints: [],
              degraded: false,
            }) as BlastResult,
        ),
        getIndexState: vi.fn(async () => {
          throw new Error('index state unavailable');
        }),
      }),
    });

    const result = await service.forPull(WORKSPACE_ID, PR_ID);

    // indexState resolves to null when getIndexState throws → treated like "failed",
    // never silently promoted to 'full'.
    expect(result.index_status).toBe('failed');
    expect(result.degraded).toBe(true);
    expect(result.changed_symbols).toEqual([{ file: 'a.ts', name: 'foo', kind: 'function' }]);
  });

  it('happy path on a full index returns a valid BlastRadius', async () => {
    const service = buildService();
    const result = await service.forPull(WORKSPACE_ID, PR_ID);
    expect(result.index_status).toBe('full');
    expect(result.degraded).toBe(false);
    expect(result.reason).toBeNull();
  });
});

describe('BlastService.forPull — index sha vs PR head', () => {
  it("passes the PR's head sha through so a lagging index is flagged stale", async () => {
    const service = buildService({
      repo: buildRepo({
        getPull: vi.fn(
          async () =>
            ({ id: PR_ID, repoId: REPO_ID, workspaceId: WORKSPACE_ID, headSha: 'head-sha' }) as never,
        ),
      }),
      repoIntel: buildRepoIntel({
        getIndexState: vi.fn(
          async () => ({ status: 'full', lastIndexedSha: 'older-sha' }) as IndexState,
        ),
      }),
    });

    const radius = await service.forPull(WORKSPACE_ID, PR_ID);

    expect(radius.indexed_sha).toBe('older-sha');
    expect(radius.index_stale).toBe(true);
    // Stale is NOT degraded: the index is intact, it just describes an older tree.
    expect(radius.index_status).toBe('full');
    expect(radius.degraded).toBe(false);
  });

  it('an index built from the head commit is not stale', async () => {
    const service = buildService({
      repo: buildRepo({
        getPull: vi.fn(
          async () =>
            ({ id: PR_ID, repoId: REPO_ID, workspaceId: WORKSPACE_ID, headSha: 'same-sha' }) as never,
        ),
      }),
      repoIntel: buildRepoIntel({
        getIndexState: vi.fn(
          async () => ({ status: 'full', lastIndexedSha: 'same-sha' }) as IndexState,
        ),
      }),
    });

    const radius = await service.forPull(WORKSPACE_ID, PR_ID);
    expect(radius.index_stale).toBe(false);
    expect(radius.indexed_sha).toBe('same-sha');
  });
});
