/** Co-located helpers for SmartDiffSection: turning per-line finding marks into
 *  per-line BLOCK coverage.
 *
 *  Why this exists at all: `SmartDiffFindingMark` (the smart-diff contract)
 *  carries only `line` — the finding's `start_line` — so on its own it can mark
 *  one row and nothing more. The full `FindingRecord` (already fetched for this
 *  PR by `usePrReviews`, and carrying `start_line`/`end_line`/`title`/
 *  `rationale`) is joined in on the CLIENT by `finding_id`. That keeps the whole
 *  feature client-side: no contract change, and none of the two-file vendored
 *  `@devdigest/shared` edits a new mark field would have required.
 *
 *  A mark whose finding is not in `findings` (a finding from an older review
 *  cycle that the smart-diff endpoint still marks, or reviews not yet loaded)
 *  degrades to a single-line block — exactly today's behaviour, never a crash. */
import type { FindingRecord, Severity, SmartDiffFindingMark } from "@devdigest/shared";
import { SEVERITY_RANK } from "./constants";

/** One finding's span within a file, plus what the tooltip needs to render. */
export interface FindingBlock {
  finding_id: string;
  severity: Severity;
  /** First line of the block — the row that carries the badge. */
  startLine: number;
  /** Last line of the block, inclusive. Equals `startLine` for a 1-line block. */
  endLine: number;
  /** Absent when the mark's finding could not be joined (see file header). */
  title?: string;
  rationale?: string;
}

/** What a single diff row needs to know about the findings covering it. */
export interface LineCoverage {
  /** Worst severity across every block covering this row — drives the tint. */
  severity: Severity;
  /** Blocks that START here, so each finding badges exactly once. */
  startsHere: FindingBlock[];
  /** True when a block covers this row but started earlier (continuation row). */
  isContinuation: boolean;
  /** Every block covering this row, worst-severity first. Drives hover
   *  (is this row part of the hovered finding?) and the boundary rules below. */
  blocks: FindingBlock[];
  /** The block hovering this row traces: the one that STARTS LATEST among those
   *  covering it. Where blocks overlap, the later-starting one is the more
   *  specific (typically nested) finding, and it is also the harder one to reach
   *  by pointer — its own badge may be far above. Ties break on the tighter span,
   *  then `finding_id`, so the choice is deterministic. */
  innermost: FindingBlock;
  /** True when this is the LAST row of at least one block — the edge that gets a
   *  boundary rule so a reader can see where one finding ends and the next
   *  begins in a stack of overlapping blocks. */
  isBlockEnd: boolean;
}

/**
 * Joins a file's marks to the PR's findings, producing one block per mark.
 *
 * `end_line` is clamped up to `start_line`: the DB column is `notNull` but
 * nothing guarantees `end_line >= start_line`, and an inverted span would
 * silently produce a block that covers no rows at all.
 */
export function resolveFindingBlocks(
  marks: SmartDiffFindingMark[],
  findingsById: Map<string, FindingRecord>,
): FindingBlock[] {
  return marks.map((mark) => {
    const finding = findingsById.get(mark.finding_id);
    if (!finding) {
      return {
        finding_id: mark.finding_id,
        severity: mark.severity,
        startLine: mark.line,
        endLine: mark.line,
      };
    }
    // The mark's own `line` wins as the block start: it is what the smart-diff
    // endpoint decided to mark, and the row id (`sd-<path>-<line>`) other code
    // scrolls to is built from it.
    const startLine = mark.line;
    return {
      finding_id: mark.finding_id,
      severity: mark.severity,
      startLine,
      endLine: Math.max(startLine, finding.end_line),
      title: finding.title,
      rationale: finding.rationale,
    };
  });
}

/**
 * Expands blocks into a per-line lookup, resolving OVERLAPS.
 *
 * Two findings can cover the same row (a CRITICAL on 20–25 with a WARNING on
 * 22–23 is ordinary). The rules, chosen so nothing is ever hidden:
 *
 * - **Tint** = the WORST severity covering the row. The nested WARNING does not
 *   punch a lighter hole through the CRITICAL block, so one block still reads
 *   as one continuous stripe. Same precedence as `worstSeverityOf`.
 * - **Badges** are per-block, on that block's FIRST row only — so an overlapping
 *   pair shows both badges (the inner one on the row where it starts), and a
 *   long block does not repeat its badge down every row it covers.
 * - **Boundaries**: a row that starts a block, and a row that ends one, are
 *   flagged so the renderer can draw a hairline rule there. With the tint alone
 *   two adjacent or nested findings of the same severity merge into one
 *   indistinguishable band; the rules are what make the seam visible.
 * - **Hover** follows `innermost` — the LATEST-STARTING block, not the worst
 *   one. See `innermostOf`.
 */
export function buildLineCoverage(blocks: FindingBlock[]): Map<number, LineCoverage> {
  const byLine = new Map<number, LineCoverage>();

  for (const block of blocks) {
    for (let line = block.startLine; line <= block.endLine; line++) {
      const existing = byLine.get(line);
      const startsHere = line === block.startLine;
      const endsHere = line === block.endLine;

      if (!existing) {
        byLine.set(line, {
          severity: block.severity,
          startsHere: startsHere ? [block] : [],
          isContinuation: !startsHere,
          blocks: [block],
          isBlockEnd: endsHere,
          innermost: block,
        });
        continue;
      }

      if (rankOf(block.severity) < rankOf(existing.severity)) existing.severity = block.severity;
      if (startsHere) existing.startsHere.push(block);
      else existing.isContinuation = true;
      if (endsHere) existing.isBlockEnd = true;
      existing.blocks.push(block);
    }
  }

  // Deterministic order per row: worst severity first, then finding_id so two
  // findings of equal severity never swap places between renders.
  const bySeverityThenId = (a: FindingBlock, b: FindingBlock) =>
    rankOf(a.severity) - rankOf(b.severity) || (a.finding_id < b.finding_id ? -1 : 1);

  for (const coverage of byLine.values()) {
    coverage.startsHere.sort(bySeverityThenId);
    coverage.blocks.sort(bySeverityThenId);
    coverage.innermost = innermostOf(coverage.blocks);
  }

  return byLine;
}

/**
 * The block a row's hover should trace: LATEST START wins.
 *
 * Where two findings overlap, the one starting later is the inner, more specific
 * claim about this row — and the one a pointer can otherwise struggle to reach,
 * since its badge sits on its own first row which may be scrolled far above.
 * Severity deliberately does NOT decide this: a nested SUGGESTION inside a
 * CRITICAL is still what the reviewer is pointing at.
 *
 * Ties (same start line) fall to the tighter span, then `finding_id`, so the
 * result never depends on input order.
 */
function innermostOf(blocks: FindingBlock[]): FindingBlock {
  return blocks.reduce((best, b) => {
    if (b.startLine !== best.startLine) return b.startLine > best.startLine ? b : best;
    const bSpan = b.endLine - b.startLine;
    const bestSpan = best.endLine - best.startLine;
    if (bSpan !== bestSpan) return bSpan < bestSpan ? b : best;
    return b.finding_id < best.finding_id ? b : best;
  });
}

function rankOf(severity: Severity): number {
  return SEVERITY_RANK[severity] ?? Number.POSITIVE_INFINITY;
}
