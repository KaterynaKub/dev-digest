import type { WorkspaceRepository } from './repository.js';

/** Clone overview for one repo, as returned by `GET /workspace`. */
export interface WorkspaceRepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}

export interface WorkspaceOverview {
  workspaceId: string;
  cloneDir: string;
  repos: WorkspaceRepoSummary[];
}

/**
 * F1 — workspace use cases. Read-only; cleanup and re-pull belong to the
 * `repos` module.
 */
/**
 * Ports this service needs. Injected explicitly — never the whole Container,
 * and never `Db`: persistence stays behind the repository.
 */
export interface WorkspaceDeps {
  repo: WorkspaceRepository;
  /** Just the clone directory, not the whole AppConfig. */
  cloneDir: string;
}

export class WorkspaceService {
  private repo: WorkspaceRepository;

  constructor(private deps: WorkspaceDeps) {
    this.repo = deps.repo;
  }

  /**
   * Workspace info + a per-repo clone summary.
   *
   * `cloned` is derived from `clonePath`, so a checkout deleted from disk still
   * reports `cloned: true` — the row is the source of truth, not the filesystem.
   */
  async overview(workspaceId: string): Promise<WorkspaceOverview> {
    const rows = await this.repo.listRepos(workspaceId);
    return {
      workspaceId,
      cloneDir: this.deps.cloneDir,
      // Response keys are snake_case while Drizzle columns are camelCase —
      // the mapping stays explicit.
      repos: rows.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  }
}
