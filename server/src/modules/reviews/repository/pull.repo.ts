import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent -----------------------------------------------------------

/** `getIntent` result: the domain Intent plus the freshness columns the
 *  service needs to judge staleness and the API needs to expose. */
export interface StoredIntent extends Intent {
  head_sha: string | null;
  derived_at: string | null;
}

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: Intent,
  headSha: string | null,
): Promise<void> {
  // Coerce nullish → [] so the NOT NULL jsonb columns never see `null`.
  const sources = intent.sources ?? [];
  const missingContext = intent.missing_context ?? [];
  const values = {
    prId,
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    confidence: intent.confidence ?? null,
    sources,
    missingContext,
    headSha,
    derivedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      // Every column, or a re-derive leaves stale values behind.
      set: {
        intent: values.intent,
        inScope: values.inScope,
        outOfScope: values.outOfScope,
        confidence: values.confidence,
        sources: values.sources,
        missingContext: values.missingContext,
        headSha: values.headSha,
        derivedAt: values.derivedAt,
      },
    });
}

export async function getIntent(db: Db, prId: string): Promise<StoredIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources as Intent['sources'],
    missing_context: row.missingContext,
    head_sha: row.headSha,
    derived_at: row.derivedAt ? row.derivedAt.toISOString() : null,
  };
}
