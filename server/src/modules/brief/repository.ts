import { and, desc, eq, lt } from 'drizzle-orm';
import type { PrBrief, BriefProvenance, RiskSeverity } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';

/** Repo-relative facts about the PR's repository (for GitHub client + Project Context). */
export interface RepoRow {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

/** A stored intent, projected to what the brief needs — no `pr_id`. */
export interface StoredIntentRow {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: number | null;
  sources: string[];
  missingContext: string[];
  headSha: string | null;
}

export interface StoredBriefRow {
  prId: string;
  body: PrBrief;
  provenance: BriefProvenance;
}

/**
 * One trimmed row of a PR's brief history (Why Timeline, 0003) — everything
 * `BriefTimelineEntry` needs except `is_current`, which is a service-layer
 * judgement against the PR's CURRENT head/indexed sha, never a stored fact.
 */
export interface TimelineRow {
  head_sha: string;
  indexed_sha: string | null;
  generated_at: string;
  risk_level: RiskSeverity;
  what: string;
}

/**
 * Brief module data-access (layer 5 — Infrastructure). Returns domain-shaped
 * objects only, never a Drizzle row — `service.ts` never imports `drizzle-orm`
 * or `db/**` (`service-no-sql`).
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup — copies `blast/repository.ts#getPull`'s gate,
   *  the one scope check `pr_files`/`pr_brief` need since neither table carries
   *  its own `workspace_id`. */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    if (!row) return undefined;
    return {
      id: row.id,
      owner: row.owner,
      name: row.name,
      fullName: row.fullName,
      clonePath: row.clonePath,
    };
  }

  async getIntent(prId: string): Promise<StoredIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    if (!row) return undefined;
    return {
      intent: row.intent,
      inScope: row.inScope,
      outOfScope: row.outOfScope,
      confidence: row.confidence,
      sources: row.sources,
      missingContext: row.missingContext,
      headSha: row.headSha,
    };
  }

  /**
   * The NEWEST brief for this PR (0003 — Why Timeline widened the key to
   * (pr_id, head_sha, indexed_sha_key), so more than one row can exist per
   * PR). Signature and return type are UNCHANGED from before the widening —
   * `is_current`, `GET /pulls/:id/brief`, and the whole shipped card keep
   * working exactly as before.
   */
  async getBrief(prId: string): Promise<StoredBriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.generatedAt))
      .limit(1);
    if (!row) return undefined;
    const json = row.json as { body: PrBrief; provenance: Omit<BriefProvenance, 'head_sha' | 'indexed_sha' | 'generated_at'> };
    return {
      prId: row.prId,
      body: json.body,
      provenance: {
        ...json.provenance,
        head_sha: row.headSha,
        indexed_sha: row.indexedSha,
        generated_at: row.generatedAt.toISOString(),
      },
    };
  }

  /**
   * Append a brief for this PR, or replace one that describes the SAME commit
   * (0003 — Why Timeline). The conflict target is the composite key
   * `(pr_id, head_sha, indexed_sha_key)`: a regeneration against an unchanged
   * head sha and `indexed_sha` replaces in place (AC-31's user-visible
   * behaviour preserved — "the model got it wrong, try again" produces one
   * row, not two); a regeneration against a NEW head sha inserts a new row,
   * which is what makes the timeline a history rather than a single cell.
   * `indexedShaKey` is `indexedSha ?? ''` — the PK-safe stand-in for AC-28's
   * "no index" value (see `db/schema/reviews.ts#prBrief` doc comment);
   * `indexedSha` itself is written and read unchanged everywhere else.
   * `head_sha`/`indexed_sha` are real, queryable columns (AC-27/AC-28's cache
   * key); everything else — including the rest of `provenance` — lives in
   * `json`, which also carries the validated `PrBrief` body (never the
   * model's raw response, NFR-22).
   */
  async upsertBrief(prId: string, body: PrBrief, provenance: BriefProvenance): Promise<void> {
    const { head_sha: headSha, indexed_sha: indexedSha, generated_at: generatedAt, ...restProvenance } = provenance;
    const json = { body, provenance: restProvenance };
    const generatedAtDate = new Date(generatedAt);
    const indexedShaKey = indexedSha ?? '';
    await this.db
      .insert(t.prBrief)
      .values({ prId, json, headSha, indexedSha, indexedShaKey, generatedAt: generatedAtDate })
      .onConflictDoUpdate({
        target: [t.prBrief.prId, t.prBrief.headSha, t.prBrief.indexedShaKey],
        set: { json, headSha, indexedSha, indexedShaKey, generatedAt: generatedAtDate },
      });
  }

  /**
   * The retained history for this PR, newest first, trimmed to what a
   * timeline entry needs (0003). Mapped to domain shape HERE, matching how
   * `getBrief` already reassembles `provenance` from columns + `json` — a
   * repository never returns a Drizzle row (`persistence` rule).
   */
  async listBriefs(prId: string, limit: number): Promise<TimelineRow[]> {
    const rows = await this.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.generatedAt))
      .limit(limit);
    return rows.map((row) => {
      const json = row.json as { body: PrBrief };
      return {
        head_sha: row.headSha,
        indexed_sha: row.indexedSha,
        generated_at: row.generatedAt.toISOString(),
        risk_level: json.body.risk_level,
        what: json.body.what,
      };
    });
  }

  /**
   * Prune this PR's brief history down to the `keep` newest rows (0003 —
   * `MAX_BRIEF_HISTORY`). Because the PK is composite there is no single id
   * column to delete by; deleting by a `generatedAt` cutoff read from the same
   * ordered query is simpler and correct here, since `generated_at` is
   * `defaultNow()` and monotonically increasing per PR in practice. The
   * cutoff delete uses strict `lt`, so a row that exactly TIES the cutoff
   * timestamp is NOT deleted — a real collision at this PR's own
   * sequential-generation precision is effectively impossible, but if it ever
   * happened this call would leave `keep + 1` rows rather than pruning an
   * extra one.
   */
  async pruneBriefs(prId: string, keep: number): Promise<void> {
    const kept = await this.db
      .select({ generatedAt: t.prBrief.generatedAt })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .orderBy(desc(t.prBrief.generatedAt))
      .limit(keep);
    if (kept.length < keep) return; // fewer rows than the cap — nothing to prune
    const cutoff = kept[kept.length - 1]?.generatedAt;
    if (!cutoff) return;
    await this.db.delete(t.prBrief).where(and(eq(t.prBrief.prId, prId), lt(t.prBrief.generatedAt, cutoff)));
  }
}
