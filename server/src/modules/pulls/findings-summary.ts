/**
 * Pure helpers that roll the latest review CYCLE's findings up into the compact
 * `PrFindings` shape carried by every PR list row (side-effect free — no DB /
 * network; the caller supplies already-fetched rows).
 *
 * A "cycle" is every run that reviewed the commit the PR was last reviewed at,
 * i.e. ALL reviewers of the last trigger — the same grouping the COST column
 * uses (see `foldCycleCost`). The two columns must agree: a cost covering three
 * reviewers next to findings from only one reads as a bug.
 *
 * Why the list carries findings at all: the FINDINGS column's hover panel must
 * open with zero network work, so the breakdown ships eagerly with the list.
 * To keep that affordable the payload is capped (`FINDINGS_PREVIEW_LIMIT`) and
 * rationales are truncated here rather than on the client.
 */
import {
  FINDINGS_PREVIEW_LIMIT,
  type Finding,
  type FindingSummary,
  type PrFindings,
  type SeverityCounts,
} from '@devdigest/shared';

/** Local cap for the hover-panel rationale preview. */
const RATIONALE_PREVIEW_CHARS = 150;

/** Sort weight — CRITICAL first, so a cap never drops the finding that matters. */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/**
 * Findings columns needed for the roll-up. `severity`/`category` are `text` in
 * the DB (not enums), hence the loose types — validation happens below.
 */
export interface FindingSummaryRow {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  rationale: string;
  confidence: number;
  dismissedAt: Date | null;
}

/** A `reviews` row, reduced to what cycle selection needs. */
export interface CycleReviewRow {
  id: string;
  /** The agent_run that produced it. NULL on rows written before run linking. */
  runId: string | null;
  createdAt: Date | null;
}

/**
 * Pick the reviews that belong to the PR's latest review CYCLE.
 *
 * Preferred path: every review whose `runId` is in `cycleRunIds` — the runs of
 * the last trigger, one per reviewer. That is what makes the column a
 * concatenation across reviewers rather than whichever agent happened to finish
 * last.
 *
 * Fallback: reviews predating run linking (`runId` NULL) — and PRs whose runs
 * predate `head_sha` tracking, leaving `cycleRunIds` empty — have no cycle to
 * group by, so we keep the previous behaviour and take the single newest
 * review. Better a narrow roll-up than an empty FINDINGS column on old data.
 */
export function selectCycleReviewIds(
  reviews: CycleReviewRow[],
  cycleRunIds: ReadonlySet<string>,
): string[] {
  const inCycle = reviews.filter((r) => r.runId != null && cycleRunIds.has(r.runId));
  if (inCycle.length > 0) return inCycle.map((r) => r.id);

  let newest: CycleReviewRow | undefined;
  for (const r of reviews) {
    if (!newest) {
      newest = r;
      continue;
    }
    // Undated rows sort last — a row with a timestamp is the better evidence.
    const a = r.createdAt?.getTime() ?? -Infinity;
    const b = newest.createdAt?.getTime() ?? -Infinity;
    if (a > b) newest = r;
  }
  return newest ? [newest.id] : [];
}

/** All-zero counts — also the roll-up for a reviewed PR with no findings. */
export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

export function emptyPrFindings(): PrFindings {
  return { counts: emptySeverityCounts(), items: [], remaining_count: 0 };
}

/**
 * Cut `text` to at most `max` characters on a word boundary, appending an
 * ellipsis. The hover panel clamps to three lines anyway, so anything longer is
 * bytes on the wire nobody reads.
 */
export function truncateRationale(text: string, max = RATIONALE_PREVIEW_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastSpace = head.lastIndexOf(' ');
  // Only honour the word boundary when it isn't pathologically early (a single
  // very long token would otherwise collapse the preview to almost nothing).
  const cut = lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

function toFindingSummary(row: FindingSummaryRow): FindingSummary {
  return {
    id: row.id,
    severity: row.severity as FindingSummary['severity'],
    category: row.category as FindingSummary['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: truncateRationale(row.rationale),
    confidence: row.confidence,
  };
}

/**
 * Roll findings up into counts + a capped, severity-ordered preview.
 *
 * Dismissed findings are excluded from BOTH counts and items: on the list the
 * chips are a triage signal, so a PR whose findings the user has worked through
 * should read as clean. Accepted findings stay counted — accepting means "yes,
 * this is a real problem", which is exactly what should remain visible.
 */
export function buildPrFindings(rows: FindingSummaryRow[]): PrFindings {
  const counts = emptySeverityCounts();
  const live: FindingSummaryRow[] = [];

  for (const row of rows) {
    if (row.dismissedAt) continue;
    // `severity` is a text column, so a legacy/seeded row could hold anything.
    // Unknown values are dropped rather than widening SeverityCounts, which is
    // a closed object and would fail to serialize on an unexpected key.
    if (!(row.severity in counts)) continue;
    counts[row.severity as Finding['severity']] += 1;
    live.push(row);
  }

  live.sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    return bySeverity !== 0 ? bySeverity : b.confidence - a.confidence;
  });

  const items = live.slice(0, FINDINGS_PREVIEW_LIMIT).map(toFindingSummary);
  return { counts, items, remaining_count: live.length - items.length };
}
