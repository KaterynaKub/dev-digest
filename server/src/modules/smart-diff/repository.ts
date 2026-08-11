import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import type { FindingLike, PrFileLike } from './helpers.js';

/**
 * 0005a — smart-diff data-access layer. Read-only: three `select`s, no
 * insert/update/delete/transaction anywhere in this file.
 */

export class SmartDiffRepository {
  constructor(private db: Db) {}

  /**
   * Workspace-scoped PR lookup — the ONLY scope check this module needs.
   * `pr_files` and `findings` carry no `workspace_id` of their own, so every
   * other query is reached only once this row is confirmed to exist.
   * Same query shape as `reviews/repository/pull.repo.ts#getPull`.
   */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * Changed files for a PR. Deliberately excludes `patch` — the largest
   * column, and this response carries no diff text (the client already has
   * patches from `GET /pulls/:id`).
   */
  async getPrFiles(prId: string): Promise<PrFileLike[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /**
   * Findings for every review of a PR, joined through `reviews` — `findings`
   * carries no `pr_id` of its own. Ordered by `reviews.created_at desc` for
   * readable tests; `selectCycleFindings` must not rely on this order.
   */
  async findingsForPull(prId: string): Promise<FindingLike[]> {
    const rows = await this.db
      .select({
        id: t.findings.id,
        file: t.findings.file,
        startLine: t.findings.startLine,
        severity: t.findings.severity,
        reviewId: t.findings.reviewId,
        agentId: t.reviews.agentId,
        createdAt: t.reviews.createdAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.reviews.prId, prId))
      .orderBy(desc(t.reviews.createdAt));
    return rows;
  }
}
