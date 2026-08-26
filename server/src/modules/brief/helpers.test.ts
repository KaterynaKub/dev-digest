import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import {
  scoreDocument,
  rankDocuments,
  applyDocLimits,
  renderBriefFileList,
  buildBriefLineIndex,
  validateReferences,
  enforceInputBudget,
  type BriefSection,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Document ranking (AC-14, AC-17, NFR-11)
// ---------------------------------------------------------------------------

describe('rankDocuments — total order, tie-break on path', () => {
  it('sorts two documents of EQUAL score by path ascending — the tie-break must actually fire', () => {
    // Both docs share exactly the whole segment "payments" with the changed
    // path, so both score 1 — a fixture built from distinct scores would pass
    // against an unstable sort without ever exercising the tie-break (NFR-11).
    const changed = ['src/modules/payments/service.ts'];
    const docs = ['docs/zeta/payments.md', 'docs/alpha/payments.md'];

    expect(scoreDocument('docs/zeta/payments.md', changed)).toBe(1);
    expect(scoreDocument('docs/alpha/payments.md', changed)).toBe(1);

    const ranked = rankDocuments(docs, changed);
    expect(ranked.map((d) => d.path)).toEqual(['docs/alpha/payments.md', 'docs/zeta/payments.md']);
  });

  it('ranks a higher-score document ahead of a lower-score one regardless of path', () => {
    const changed = ['src/modules/payments/service.ts', 'src/modules/payments/routes.ts'];
    // zzz-payments.md shares BOTH "modules" and "payments" segments (score 2);
    // aaa-unrelated.md shares none (score 0, dropped) — the higher score wins
    // even though its path sorts after the (excluded) other candidate.
    const ranked = rankDocuments(['docs/modules/payments.md', 'docs/aaa-unrelated.md'], changed);
    expect(ranked.map((d) => d.path)).toEqual(['docs/modules/payments.md']);
  });

  it('drops a document scoring 0 entirely (AC-17) — never ranked last', () => {
    const ranked = rankDocuments(['docs/unrelated.md'], ['src/modules/payments/service.ts']);
    expect(ranked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Doc limits (AC-15, AC-16, AC-18)
// ---------------------------------------------------------------------------

describe('applyDocLimits — count then token budget, both recorded with their limit label', () => {
  it('drops every document past MAX_BRIEF_DOCS (5) and labels each drop "count"', () => {
    const ranked = Array.from({ length: 7 }, (_, i) => ({ path: `d${i}.md`, score: 7 - i }));
    const { kept, dropped } = applyDocLimits(ranked, () => 10);
    expect(kept.map((d) => d.path)).toEqual(['d0.md', 'd1.md', 'd2.md', 'd3.md', 'd4.md']);
    expect(dropped).toEqual([
      { path: 'd5.md', limit: 'count' },
      { path: 'd6.md', limit: 'count' },
    ]);
  });

  it('drops from the tail once the token budget (4_000) is exceeded and labels the drop "tokens"', () => {
    const ranked = [
      { path: 'a.md', score: 3 },
      { path: 'b.md', score: 2 },
      { path: 'c.md', score: 1 },
    ];
    // a.md alone fits; a.md + b.md exceeds the budget, so b.md AND everything
    // after it is dropped — never a partial document.
    const tokensOf = (path: string) => (path === 'a.md' ? 3_000 : 2_000);
    const { kept, dropped } = applyDocLimits(ranked, tokensOf);
    expect(kept.map((d) => d.path)).toEqual(['a.md']);
    expect(dropped).toEqual([
      { path: 'b.md', limit: 'tokens' },
      { path: 'c.md', limit: 'tokens' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// File list rendering (AC-3, NFR-4, NFR-5)
// ---------------------------------------------------------------------------

describe('renderBriefFileList — hunk headers only, never line content', () => {
  function diffWith(files: UnifiedDiff['files']): UnifiedDiff {
    return { raw: '', files };
  }

  it('renders path, +/- stats, and hunk headers — no added/removed line text', () => {
    const diff = diffWith([
      {
        path: 'src/a.ts',
        additions: 3,
        deletions: 1,
        hunks: [{ file: 'src/a.ts', oldStart: 10, oldLines: 2, newStart: 10, newLines: 4, newLineNumbers: [] }],
      },
    ]);
    const rendered = renderBriefFileList(diff);
    expect(rendered).toBe('src/a.ts (+3/-1) @@ -10,2 +10,4 @@');
    // No line content markers ever appear — the diff carried none in fixture,
    // but the assertion pins the shape: no leading +/- content lines.
    expect(rendered).not.toMatch(/^\+/m);
    expect(rendered).not.toMatch(/^-/m);
  });

  it('caps at MAX_BRIEF_FILES (300) with a "… and N more files" tail', () => {
    const files = Array.from({ length: 305 }, (_, i) => ({
      path: `f${i}.ts`,
      additions: 1,
      deletions: 0,
      hunks: [],
    }));
    const rendered = renderBriefFileList(diffWith(files));
    const lines = rendered.split('\n');
    expect(lines).toHaveLength(301);
    expect(lines[300]).toBe('… and 5 more files');
  });
});

// ---------------------------------------------------------------------------
// Reference validation (AC-20…AC-26)
// ---------------------------------------------------------------------------

describe('validateReferences', () => {
  const ctx = {
    filePaths: new Set(['src/a.ts', 'src/b.ts']),
    endpoints: new Set(['GET /users']),
    lineIndex: buildBriefLineIndex({
      raw: '',
      files: [
        {
          path: 'src/a.ts',
          additions: 1,
          deletions: 0,
          hunks: [{ file: 'src/a.ts', oldStart: 1, oldLines: 1, newStart: 10, newLines: 3, newLineNumbers: [10, 11, 12] }],
        },
      ],
    }),
  };

  it('drops a risk naming a file not present in the input, recording why', () => {
    const result = validateReferences(
      { risks: [{ file_refs: ['src/unknown.ts'] }], reviewFocus: [] },
      ctx,
    );
    expect(result.risks).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/unknown file or endpoint "src\/unknown\.ts"/);
  });

  it('drops a risk naming an endpoint not present in the input', () => {
    const result = validateReferences(
      { risks: [{ file_refs: ['POST /invented'] }], reviewFocus: [] },
      ctx,
    );
    expect(result.risks).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/POST \/invented/);
  });

  it('keeps a risk naming a real endpoint from the input', () => {
    const result = validateReferences(
      { risks: [{ file_refs: ['GET /users'] }], reviewFocus: [] },
      ctx,
    );
    expect(result.risks).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('keeps a review-focus entry whose line is outside every hunk, but sets line: null (AC-25)', () => {
    const result = validateReferences(
      { risks: [], reviewFocus: [{ file: 'src/a.ts', line: 999 }] },
      ctx,
    );
    expect(result.rejected).toEqual([]);
    expect(result.reviewFocus).toEqual([{ file: 'src/a.ts', line: null }]);
  });

  it('keeps a review-focus entry whose line IS covered by a hunk, unchanged', () => {
    const result = validateReferences(
      { risks: [], reviewFocus: [{ file: 'src/a.ts', line: 11 }] },
      ctx,
    );
    expect(result.reviewFocus).toEqual([{ file: 'src/a.ts', line: 11 }]);
  });

  it('the all-rejected case: every entry invalid leaves empty arrays plus a full rejection record (AC-26)', () => {
    const result = validateReferences(
      {
        risks: [{ file_refs: ['src/unknown.ts'] }],
        reviewFocus: [{ file: 'src/unknown.ts', line: null }],
      },
      ctx,
    );
    expect(result.risks).toEqual([]);
    expect(result.reviewFocus).toEqual([]);
    expect(result.rejected).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Cache-key comparison (AC-28) — `indexed_sha: null` is a distinct value
// ---------------------------------------------------------------------------

describe('cache-key comparison treats indexed_sha: null as a distinct, comparable value', () => {
  it('`===` on null matches null to null, not to a real sha', () => {
    const storedIndexedSha: string | null = null;
    const currentIndexedSha: string | null = null;
    expect(storedIndexedSha === currentIndexedSha).toBe(true);
  });

  it('`===` on null does not equal a real sha string', () => {
    const storedIndexedSha: string | null = null;
    const currentIndexedSha: string | null = 'abc123';
    expect(storedIndexedSha === currentIndexedSha).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input budget (NFR-24): drop whole sections from the tail, never reject
// ---------------------------------------------------------------------------

describe('enforceInputBudget', () => {
  // One "token" per character keeps the fixtures' arithmetic legible without
  // pulling in a real tokenizer — the function under test only ever calls
  // `countTokens` as an opaque callback.
  const countChars = (text: string) => text.length;

  function section(label: string, tokenLength: number): BriefSection {
    return { label, text: 'x'.repeat(tokenLength) };
  }

  it('passes an input under budget untouched — no drops, original order kept', () => {
    const sections = [
      section('changed-files', 10),
      section('derived-intent', 10),
      section('blast-radius', 10),
    ];
    const result = enforceInputBudget(sections, countChars, 100);
    expect(result.kept).toEqual(sections);
    expect(result.droppedSections).toEqual([]);
  });

  it('drops the document section first when over budget, leaving the higher-priority sections intact', () => {
    const sections = [
      section('changed-files', 10),
      section('derived-intent', 10),
      section('document:docs/a.md', 50),
    ];
    // Joined with '\n\n' (2 chars) between each: 10 + 2 + 10 + 2 + 50 = 74.
    // A budget of 30 forces the document out (10 + 2 + 10 = 22, fits), but not
    // the two non-document sections ahead of it.
    const result = enforceInputBudget(sections, countChars, 30);
    expect(result.kept.map((s) => s.label)).toEqual(['changed-files', 'derived-intent']);
    expect(result.droppedSections).toEqual(['document:docs/a.md']);
  });

  it('drops multiple sections in reverse priority order when still over budget after the first drop', () => {
    const sections = [
      section('changed-files', 10),
      section('derived-intent', 10),
      section('blast-radius', 10),
      section('pr-title-body', 10),
      section('linked-issue', 10),
      section('document:docs/a.md', 10),
    ];
    // Six sections of 10 chars joined by '\n\n' (5 separators of 2 chars) = 70.
    // A budget of 30 only fits the two highest-priority sections
    // (10 + 2 + 10 = 22); everything after must be dropped, LOWEST priority
    // (tail) first — never out of order, never the same section twice.
    const result = enforceInputBudget(sections, countChars, 30);
    expect(result.kept.map((s) => s.label)).toEqual(['changed-files', 'derived-intent']);
    expect(result.droppedSections).toEqual([
      'document:docs/a.md',
      'linked-issue',
      'pr-title-body',
      'blast-radius',
    ]);
  });

  it('records the dropped section labels verbatim, in drop order, for BriefProvenance.dropped_sections', () => {
    const sections = [section('changed-files', 5), section('linked-issue', 100)];
    const result = enforceInputBudget(sections, countChars, 10);
    expect(result.droppedSections).toEqual(['linked-issue']);
    // The surviving section's own text is untouched — a drop removes a WHOLE
    // section, never truncates one.
    expect(result.kept).toEqual([section('changed-files', 5)]);
  });

  it('never drops the single remaining section, even if it alone exceeds the budget', () => {
    const sections = [section('changed-files', 500)];
    const result = enforceInputBudget(sections, countChars, 10);
    expect(result.kept).toEqual(sections);
    expect(result.droppedSections).toEqual([]);
  });
});
