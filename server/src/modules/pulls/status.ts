import type { CostSource, PrStatus } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

/**
 * Fold the runs of ONE review cycle into the single figure the PR list shows.
 *
 * Summing in JS rather than SQL is deliberate: we need to carry the cost SOURCE
 * alongside the total, and `SUM()` silently skips NULLs — which would hide the
 * fact that part of the cycle had no price at all.
 *
 * Degrades to the worst state seen: an unpriced run (or one already flagged
 * 'partial') makes the whole cycle a LOWER BOUND; otherwise a single price-book
 * estimate makes it 'estimated'. Returns a null total only when NOTHING was
 * known, so the UI can render "—" instead of a fabricated $0.00.
 */
export function foldCycleCost(
  runs: { costUsd: number | null; costSource: string | null }[],
): { usd: number | null; source: CostSource | null } {
  let sum: number | null = null;
  let missing = false;
  let estimated = false;
  for (const r of runs) {
    // `== null`, not truthiness — a free model legitimately costs 0.
    if (r.costUsd == null) {
      missing = true;
      continue;
    }
    sum = (sum ?? 0) + r.costUsd;
    if (r.costSource === 'estimated') estimated = true;
    if (r.costSource === 'partial') missing = true;
  }
  if (sum == null) return { usd: null, source: null };
  return { usd: sum, source: missing ? 'partial' : estimated ? 'estimated' : 'exact' };
}
