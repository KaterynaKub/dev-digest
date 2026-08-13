import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';

/**
 * 0007 — blast data-access layer. Read-only: two `select`s, no
 * insert/update/delete/transaction anywhere in this file. Mirrors
 * `smart-diff/repository.ts` shape.
 */

export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * Workspace-scoped PR lookup — the ONLY scope check this module needs.
   * `pr_files` has no `workspace_id` of its own, so `getPrFiles` is reached
   * only once this row is confirmed to exist. `pull.repoId` is what
   * `repoIntel.getBlastRadius` needs, so no separate `repos` query is
   * required.
   */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * Changed-file paths for a PR — nothing else. Blast only needs the path
   * list to hand to `repoIntel.getBlastRadius`; no patch, no additions/deletions.
   */
  async getPrFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }
}
