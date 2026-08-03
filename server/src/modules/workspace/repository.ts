import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — workspace data-access layer. Read-only: the overview screen needs the
 * repo rows of one workspace and nothing else. Every query is scoped by
 * `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export class WorkspaceRepository {
  constructor(private db: Db) {}

  /** All repos in a workspace, for the clone overview. */
  async listRepos(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }
}
