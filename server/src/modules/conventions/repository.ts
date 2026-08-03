import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionStatus } from '@devdigest/shared';
import { isDuplicateRule, type VerifiedCandidate } from './helpers.js';

/**
 * Conventions data-access. The ONLY place that touches `conventions` and
 * `convention_scans`. Every query is scoped by `workspaceId`.
 */

import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
export type { ConventionRow, ConventionScanRow };

export interface RecordScanInput {
  workspaceId: string;
  repoId: string;
  sampleCount: number;
  configCount: number;
  candidatesRaw: number;
  model: string;
  candidates: VerifiedCandidate[];
}

export interface RecordScanResult {
  scan: ConventionScanRow;
  rows: ConventionRow[];
}

export interface UpdateConventionPatch {
  rule?: string;
  category?: string;
  status?: ConventionStatus;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** The most recent scan for a repo, or undefined when never scanned. */
  async getLatestScan(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)),
      )
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }

  /**
   * Every candidate for a repo. Accepted first (they drive the "Create skill"
   * action), then by confidence, then oldest-first for a stable order.
   */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(
        sql`case ${t.conventions.status} when 'accepted' then 0 when 'pending' then 1 else 2 end`,
        desc(t.conventions.confidence),
        t.conventions.createdAt,
      );
  }

  /** Accepted candidates only — the input to the merged skill draft. */
  async listAcceptedByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(desc(t.conventions.confidence), t.conventions.createdAt);
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Persist one extraction run, in a single transaction:
   *
   *  1. insert the scan row
   *  2. CARRY FORWARD rows a human touched (accepted/rejected/edited) by
   *     re-pointing them at the new scan — a human decision outranks a
   *     re-derivation
   *  3. DELETE untouched `pending` rows from older scans — nobody cared about
   *     them and they would duplicate
   *  4. insert the new candidates, skipping any that duplicate a carried-forward
   *     rule on the same file
   *
   * Steps 2-4 are the answer to "how does an accepted convention survive a
   * re-scan"; it is not derivable from the schema, so it is documented in the
   * module CLAUDE.md too.
   */
  async recordScan(input: RecordScanInput): Promise<RecordScanResult> {
    return this.db.transaction(async (tx) => {
      const [scan] = await tx
        .insert(t.conventionScans)
        .values({
          workspaceId: input.workspaceId,
          repoId: input.repoId,
          sampleCount: input.sampleCount,
          configCount: input.configCount,
          candidatesRaw: input.candidatesRaw,
          candidatesKept: input.candidates.length,
          model: input.model,
        })
        .returning();

      const scanId = scan!.id;
      const scoped = and(
        eq(t.conventions.workspaceId, input.workspaceId),
        eq(t.conventions.repoId, input.repoId),
      );

      // 2. Carry forward everything a human touched.
      const carried = await tx
        .update(t.conventions)
        .set({ scanId })
        .where(
          and(
            scoped,
            sql`(${t.conventions.status} <> 'pending' or ${t.conventions.edited} = true)`,
          ),
        )
        .returning();

      // 3. Drop untouched pending rows from previous scans.
      await tx
        .delete(t.conventions)
        .where(and(scoped, eq(t.conventions.status, 'pending'), ne(t.conventions.scanId, scanId)));

      // 4. Insert what is genuinely new.
      const fresh = input.candidates.filter(
        (c) =>
          !carried.some(
            (k) => k.evidencePath === c.evidencePath && isDuplicateRule(k.rule, c.rule),
          ),
      );

      const inserted = fresh.length
        ? await tx
            .insert(t.conventions)
            .values(
              fresh.map((c) => ({
                workspaceId: input.workspaceId,
                repoId: input.repoId,
                scanId,
                category: c.category,
                rule: c.rule,
                evidencePath: c.evidencePath,
                evidenceStartLine: c.evidenceStartLine,
                evidenceEndLine: c.evidenceEndLine,
                evidenceSnippet: c.evidenceSnippet,
                confidence: c.confidence,
              })),
            )
            .returning()
        : [];

      return { scan: scan!, rows: [...carried, ...inserted] };
    });
  }

  /**
   * Patch one candidate. Editing `rule` or `category` sets `edited`, which is
   * what makes the row survive the next re-scan.
   */
  async updateOne(
    workspaceId: string,
    id: string,
    patch: UpdateConventionPatch,
  ): Promise<ConventionRow | undefined> {
    const touchesText = patch.rule !== undefined || patch.category !== undefined;
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(touchesText ? { edited: true } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /**
   * Bulk status change. With `ids` it targets exactly those; without, it
   * targets every `pending` candidate of the repo — which is what the
   * "Accept all (N)" / "Reject all" buttons mean. Already-decided rows are
   * left alone by the no-ids form so "Accept all" never revives a rejection.
   */
  async bulkSetStatus(
    workspaceId: string,
    repoId: string,
    status: ConventionStatus,
    ids?: string[],
  ): Promise<number> {
    if (ids && ids.length === 0) return 0;
    const scoped = and(
      eq(t.conventions.workspaceId, workspaceId),
      eq(t.conventions.repoId, repoId),
    );
    const rows = await this.db
      .update(t.conventions)
      .set({ status })
      .where(
        ids
          ? and(scoped, inArray(t.conventions.id, ids))
          : and(scoped, eq(t.conventions.status, 'pending')),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }
}
