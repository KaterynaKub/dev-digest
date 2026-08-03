import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — polling data-access layer. Owns the PR-list upsert and the
 * `last_polled_at` bump. Every read is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

/** One PR as returned by the GitHub adapter, ready to persist. */
export interface UpsertPullRequest {
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  additions: number;
  deletions: number;
  files_count: number;
  status: string;
  /** Absent on PRs GitHub has never updated — treated the same as null. */
  updated_at?: string | null;
}

export class PollingRepository {
  constructor(private db: Db) {}

  async findRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Upsert on `(repoId, number)`, updating only mutable fields, so local review
   * history survives a re-poll.
   */
  async upsertPullRequest(
    workspaceId: string,
    repoId: string,
    pr: UpsertPullRequest,
  ): Promise<void> {
    const updatedAt = pr.updated_at ? new Date(pr.updated_at) : null;
    await this.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        headSha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesCount: pr.files_count,
        status: pr.status,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: pr.title,
          headSha: pr.head_sha,
          status: pr.status,
          updatedAt,
        },
      });
  }

  async markPolled(repoId: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }
}
