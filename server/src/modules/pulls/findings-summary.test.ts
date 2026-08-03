/**
 * findings-summary — the roll-up behind the PR list's FINDINGS column.
 *
 * The interesting rules all live here rather than in the route: which findings
 * count, what order survives the cap, and how much rationale ships.
 */
import { describe, it, expect } from 'vitest';
import { FINDINGS_PREVIEW_LIMIT } from '@devdigest/shared';
import {
  buildPrFindings,
  selectCycleReviewIds,
  truncateRationale,
  type CycleReviewRow,
  type FindingSummaryRow,
} from './findings-summary.js';

function row(o: Partial<FindingSummaryRow> & { id: string }): FindingSummaryRow {
  return {
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded secret',
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    rationale: 'A literal Stripe key is committed.',
    confidence: 0.9,
    dismissedAt: null,
    ...o,
  };
}

describe('buildPrFindings — what counts', () => {
  it('counts each severity separately', () => {
    const out = buildPrFindings([
      row({ id: '1', severity: 'CRITICAL' }),
      row({ id: '2', severity: 'WARNING' }),
      row({ id: '3', severity: 'WARNING' }),
      row({ id: '4', severity: 'SUGGESTION' }),
    ]);
    expect(out.counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 1 });
    expect(out.items).toHaveLength(4);
  });

  it('excludes dismissed findings but keeps accepted ones', () => {
    // Dismissed means the user triaged it away — the list should read as clean.
    // Accepted means "yes, this is real", which must stay visible.
    const out = buildPrFindings([
      row({ id: '1' }),
      row({ id: '2', dismissedAt: new Date('2026-06-11T19:00:00Z') }),
    ]);
    expect(out.counts.CRITICAL).toBe(1);
    expect(out.items.map((f) => f.id)).toEqual(['1']);
  });

  it('ignores unknown severity values instead of crashing', () => {
    // `severity` is a text column, so legacy/seeded rows can hold anything.
    // A stray value must not leak into the closed SeverityCounts shape.
    const out = buildPrFindings([row({ id: '1', severity: 'INFO' }), row({ id: '2' })]);
    expect(out.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(out.items.map((f) => f.id)).toEqual(['2']);
  });

  it('returns an all-zero roll-up for a reviewed PR with no findings', () => {
    const out = buildPrFindings([]);
    expect(out).toEqual({
      counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      items: [],
      truncated: 0,
    });
  });
});

describe('buildPrFindings — ordering and the cap', () => {
  it('keeps CRITICAL ahead of everything, even when it arrives last', () => {
    // Insertion order would push the critical past the cap — exactly the case
    // the ordering exists to prevent.
    const suggestions = Array.from({ length: FINDINGS_PREVIEW_LIMIT }, (_, i) =>
      row({ id: `s${i}`, severity: 'SUGGESTION' }),
    );
    const out = buildPrFindings([...suggestions, row({ id: 'crit', severity: 'CRITICAL' })]);
    expect(out.items[0]?.id).toBe('crit');
    expect(out.items).toHaveLength(FINDINGS_PREVIEW_LIMIT);
  });

  it('breaks severity ties by confidence, highest first', () => {
    const out = buildPrFindings([
      row({ id: 'low', confidence: 0.4 }),
      row({ id: 'high', confidence: 0.95 }),
      row({ id: 'mid', confidence: 0.7 }),
    ]);
    expect(out.items.map((f) => f.id)).toEqual(['high', 'mid', 'low']);
  });

  it('reports counts over ALL findings while capping the preview', () => {
    const rows = Array.from({ length: FINDINGS_PREVIEW_LIMIT + 8 }, (_, i) => row({ id: `f${i}` }));
    const out = buildPrFindings(rows);
    expect(out.counts.CRITICAL).toBe(FINDINGS_PREVIEW_LIMIT + 8); // chips stay truthful
    expect(out.items).toHaveLength(FINDINGS_PREVIEW_LIMIT);
    expect(out.truncated).toBe(8);
  });

  it('does not count dismissed findings toward `truncated`', () => {
    const rows = [
      ...Array.from({ length: FINDINGS_PREVIEW_LIMIT }, (_, i) => row({ id: `f${i}` })),
      row({ id: 'gone', dismissedAt: new Date('2026-06-11T19:00:00Z') }),
    ];
    expect(buildPrFindings(rows).truncated).toBe(0);
  });
});

describe('selectCycleReviewIds', () => {
  const review = (o: Partial<CycleReviewRow> & { id: string }): CycleReviewRow => ({
    runId: null,
    createdAt: new Date('2026-06-11T19:00:00Z'),
    ...o,
  });

  it('takes EVERY reviewer of the cycle, not just the newest', () => {
    // The whole point of the change: one trigger fans out to one run per agent,
    // and the FINDINGS column is their union.
    const ids = selectCycleReviewIds(
      [
        review({ id: 'claude', runId: 'run-a' }),
        review({ id: 'gpt', runId: 'run-b' }),
        review({ id: 'previous-cycle', runId: 'run-old' }),
      ],
      new Set(['run-a', 'run-b']),
    );
    expect(ids.sort()).toEqual(['claude', 'gpt']);
  });

  it('excludes reviews from an earlier cycle', () => {
    const ids = selectCycleReviewIds(
      [review({ id: 'current', runId: 'run-a' }), review({ id: 'stale', runId: 'run-old' })],
      new Set(['run-a']),
    );
    expect(ids).toEqual(['current']);
  });

  it('falls back to the newest single review when no run links exist', () => {
    // Reviews written before run linking (runId NULL) belong to no cycle —
    // better a narrow roll-up than an empty FINDINGS column on old data.
    const ids = selectCycleReviewIds(
      [
        review({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
        review({ id: 'newest', createdAt: new Date('2026-05-01T00:00:00Z') }),
      ],
      new Set(),
    );
    expect(ids).toEqual(['newest']);
  });

  it('falls back when the cycle run ids match nothing (runs predate head_sha)', () => {
    const ids = selectCycleReviewIds(
      [
        review({ id: 'old', runId: 'run-x', createdAt: new Date('2026-01-01T00:00:00Z') }),
        review({ id: 'newest', runId: 'run-y', createdAt: new Date('2026-05-01T00:00:00Z') }),
      ],
      new Set(['run-unrelated']),
    );
    expect(ids).toEqual(['newest']);
  });

  it('prefers a dated review over an undated one in the fallback', () => {
    const ids = selectCycleReviewIds(
      [review({ id: 'undated', createdAt: null }), review({ id: 'dated' })],
      new Set(),
    );
    expect(ids).toEqual(['dated']);
  });

  it('returns nothing for a PR with no reviews', () => {
    expect(selectCycleReviewIds([], new Set(['run-a']))).toEqual([]);
  });
});

describe('buildPrFindings — across reviewers', () => {
  it('merges and re-ranks findings from several reviews of one cycle', () => {
    // Concatenating per-reviewer rows must not preserve reviewer order — the
    // cap has to keep the CRITICAL from the second agent.
    const claude = [row({ id: 'c1', severity: 'SUGGESTION' })];
    const gpt = [row({ id: 'g1', severity: 'CRITICAL' }), row({ id: 'g2', severity: 'WARNING' })];
    const out = buildPrFindings([...claude, ...gpt]);
    expect(out.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1 });
    expect(out.items.map((f) => f.id)).toEqual(['g1', 'g2', 'c1']);
  });
});

describe('truncateRationale', () => {
  it('leaves short text untouched', () => {
    expect(truncateRationale('Short enough.', 50)).toBe('Short enough.');
  });

  it('cuts on a word boundary and marks the elision', () => {
    const out = truncateRationale('alpha beta gamma delta epsilon', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).not.toMatch(/\s…$/); // no dangling space before the ellipsis
    expect('alpha beta gamma delta epsilon').toContain(out.slice(0, -1));
  });

  it('falls back to a hard cut when there is no usable word boundary', () => {
    // One very long token would otherwise collapse the preview to nothing.
    const out = truncateRationale(`a ${'x'.repeat(80)}`, 20);
    expect(out).toBe(`${`a ${'x'.repeat(80)}`.slice(0, 20)}…`);
  });

  it('truncates rationale when building the roll-up', () => {
    const long = 'word '.repeat(200).trim();
    const out = buildPrFindings([row({ id: '1', rationale: long })]);
    expect(out.items[0]!.rationale.length).toBeLessThan(long.length);
    expect(out.items[0]!.rationale.endsWith('…')).toBe(true);
  });
});
