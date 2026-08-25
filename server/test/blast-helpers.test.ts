import { describe, it, expect } from 'vitest';
import {
  buildBlastRadius,
  type BlastResultLike,
  type IndexStateLike,
} from '../src/modules/blast/helpers.js';

/**
 * 0007 — pure helpers, no DB, no mocks. Mirrors the transform rules and
 * acceptance criteria in specs/0007-blast-radius.md §4.5/§5/§9.
 */

function emptyResult(overrides: Partial<BlastResultLike> = {}): BlastResultLike {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
}

const FULL: IndexStateLike = { status: 'full' };
const PARTIAL: IndexStateLike = { status: 'partial' };

describe('buildBlastRadius — grouping per changed symbol', () => {
  it('groups a flat caller list by viaSymbol', () => {
    const result = emptyResult({
      changedSymbols: [
        { file: 'a.ts', name: 'foo', kind: 'function' },
        { file: 'b.ts', name: 'bar', kind: 'function' },
      ],
      callers: [
        { file: 'c.ts', symbol: 'callerA', viaSymbol: 'foo', line: 10, rank: 1 },
        { file: 'd.ts', symbol: 'callerB', viaSymbol: 'foo', line: 20, rank: 2 },
        { file: 'e.ts', symbol: 'callerC', viaSymbol: 'bar', line: 5, rank: 0 },
      ],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);

    expect(radius.downstream).toHaveLength(2);
    const foo = radius.downstream.find((d) => d.symbol === 'foo');
    const bar = radius.downstream.find((d) => d.symbol === 'bar');
    expect(foo?.callers).toHaveLength(2);
    expect(bar?.callers).toHaveLength(1);
  });

  it('maps BlastCallerRow{file,symbol,line} to BlastCaller{name,file,line}', () => {
    const result = emptyResult({
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'c.ts', symbol: 'callerA', viaSymbol: 'foo', line: 10, rank: 1 }],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);

    expect(radius.downstream[0]?.callers[0]).toEqual({ name: 'callerA', file: 'c.ts', line: 10 });
  });
});

describe('buildBlastRadius — endpoint/cron attribution via factsByFile', () => {
  it('attributes endpoints/crons only to the symbol whose callers live in that file', () => {
    const result = emptyResult({
      changedSymbols: [
        { file: 'a.ts', name: 'foo', kind: 'function' },
        { file: 'b.ts', name: 'bar', kind: 'function' },
      ],
      callers: [
        { file: 'routes/x.ts', symbol: 'handler', viaSymbol: 'foo', line: 1, rank: 5 },
        { file: 'jobs/y.ts', symbol: 'runner', viaSymbol: 'bar', line: 1, rank: 3 },
      ],
      factsByFile: {
        'routes/x.ts': { endpoints: ['GET /api/x'], crons: [] },
        'jobs/y.ts': { endpoints: [], crons: ['nightly-sync'] },
      },
      impactedEndpoints: ['GET /api/x'],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);

    const foo = radius.downstream.find((d) => d.symbol === 'foo');
    const bar = radius.downstream.find((d) => d.symbol === 'bar');
    expect(foo?.endpoints_affected).toEqual(['GET /api/x']);
    expect(foo?.crons_affected).toEqual([]);
    expect(bar?.endpoints_affected).toEqual([]);
    expect(bar?.crons_affected).toEqual(['nightly-sync']);
  });

  it('degraded path (factsByFile absent) never invents attribution from impactedEndpoints', () => {
    const result = emptyResult({
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'routes/x.ts', symbol: 'handler', viaSymbol: 'foo', line: 1, rank: 0 }],
      impactedEndpoints: ['GET /api/x', 'POST /api/y'],
      // factsByFile intentionally absent — ripgrep/degraded path.
      degraded: true,
      reason: 'no_data',
    });

    const radius = buildBlastRadius(result, FULL);

    const foo = radius.downstream.find((d) => d.symbol === 'foo');
    expect(foo?.endpoints_affected).toEqual([]);
    expect(foo?.crons_affected).toEqual([]);
  });
});

describe('buildBlastRadius — determinism', () => {
  it('two calls with input in a different order produce a byte-identical result', () => {
    const rowsA = [
      { file: 'c.ts', symbol: 'callerA', viaSymbol: 'foo', line: 10, rank: 1 },
      { file: 'a.ts', symbol: 'callerZ', viaSymbol: 'foo', line: 2, rank: 1 },
      { file: 'b.ts', symbol: 'callerB', viaSymbol: 'bar', line: 5, rank: 9 },
    ];
    const rowsB = [rowsA[2]!, rowsA[0]!, rowsA[1]!];

    const changedSymbols = [
      { file: 'a.ts', name: 'foo', kind: 'function' },
      { file: 'b.ts', name: 'bar', kind: 'function' },
    ];

    const radiusA = buildBlastRadius(
      emptyResult({ changedSymbols, callers: rowsA, degraded: false }),
      FULL,
    );
    const radiusB = buildBlastRadius(
      emptyResult({ changedSymbols: [...changedSymbols].reverse(), callers: rowsB, degraded: false }),
      FULL,
    );

    expect(JSON.stringify(radiusA)).toBe(JSON.stringify(radiusB));
  });

  it('total tie-break: equal caller count and rank falls back to symbol name ascending', () => {
    const result = emptyResult({
      changedSymbols: [
        { file: 'a.ts', name: 'zeta', kind: 'function' },
        { file: 'b.ts', name: 'alpha', kind: 'function' },
      ],
      callers: [
        { file: 'c.ts', symbol: 'x', viaSymbol: 'zeta', line: 1, rank: 1 },
        { file: 'd.ts', symbol: 'y', viaSymbol: 'alpha', line: 1, rank: 1 },
      ],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);
    expect(radius.downstream.map((d) => d.symbol)).toEqual(['alpha', 'zeta']);
  });

  it('callers within a symbol sort by rank desc, then file asc, then line asc', () => {
    const result = emptyResult({
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'z.ts', symbol: 'c1', viaSymbol: 'foo', line: 5, rank: 1 },
        { file: 'a.ts', symbol: 'c2', viaSymbol: 'foo', line: 20, rank: 5 },
        { file: 'a.ts', symbol: 'c3', viaSymbol: 'foo', line: 3, rank: 5 },
      ],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);
    expect(radius.downstream[0]?.callers.map((c) => c.name)).toEqual(['c3', 'c2', 'c1']);
  });
});

describe('buildBlastRadius — limits applied after sorting', () => {
  it('caps callers per symbol to the least important AFTER sorting by rank', () => {
    const callers = Array.from({ length: 30 }, (_, i) => ({
      file: `f${i}.ts`,
      symbol: `c${i}`,
      viaSymbol: 'foo',
      line: 1,
      rank: i, // 0..29, so the 20 highest ranks (10..29) should survive
    }));
    const result = emptyResult({
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers,
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);
    const kept = radius.downstream[0]?.callers.map((c) => c.name) ?? [];
    expect(kept).toHaveLength(20);
    expect(kept).toContain('c29');
    expect(kept).not.toContain('c0');
  });
});

describe('buildBlastRadius — symbols without callers', () => {
  it('a changed symbol with zero callers is present in changed_symbols, absent from downstream', () => {
    const result = emptyResult({
      changedSymbols: [
        { file: 'a.ts', name: 'foo', kind: 'function' },
        { file: 'b.ts', name: 'unused', kind: 'function' },
      ],
      callers: [{ file: 'c.ts', symbol: 'caller', viaSymbol: 'foo', line: 1, rank: 1 }],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);
    expect(radius.changed_symbols.map((s) => s.name)).toEqual(['foo', 'unused']);
    expect(radius.downstream.map((d) => d.symbol)).toEqual(['foo']);
  });
});

describe('buildBlastRadius — empty input never throws', () => {
  it('empty result on a full index yields a valid BlastRadius with an explanatory summary', () => {
    const radius = buildBlastRadius(emptyResult({ degraded: false }), FULL);
    expect(radius.changed_symbols).toEqual([]);
    expect(radius.downstream).toEqual([]);
    expect(radius.index_status).toBe('full');
    expect(radius.degraded).toBe(false);
    expect(radius.reason).toBeNull();
    expect(radius.summary.length).toBeGreaterThan(0);
  });
});

describe('buildBlastRadius — summary arithmetic', () => {
  it('counts callers across N distinct files, not the raw caller count', () => {
    const result = emptyResult({
      changedSymbols: [
        { file: 'a.ts', name: 'foo', kind: 'function' },
        { file: 'b.ts', name: 'bar', kind: 'function' },
      ],
      callers: [
        { file: 'same.ts', symbol: 'c1', viaSymbol: 'foo', line: 1, rank: 1 },
        { file: 'same.ts', symbol: 'c2', viaSymbol: 'bar', line: 2, rank: 1 },
      ],
      degraded: false,
    });

    const radius = buildBlastRadius(result, FULL);
    expect(radius.summary).toContain('2 caller');
    expect(radius.summary).toContain('1 file');
  });
});

describe('buildBlastRadius — index state, the main requirement of this iteration', () => {
  it("full index + empty downstream → degraded:false, reason:null, summary says 'no downstream callers found'", () => {
    const radius = buildBlastRadius(
      emptyResult({ changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }], degraded: false }),
      FULL,
    );
    expect(radius.index_status).toBe('full');
    expect(radius.degraded).toBe(false);
    expect(radius.reason).toBeNull();
    expect(radius.summary.toLowerCase()).toContain('no downstream callers found');
  });

  it("partial index → degraded:true, reason:'index_partial', summary warns of incompleteness", () => {
    const radius = buildBlastRadius(emptyResult({ degraded: false }), PARTIAL);
    expect(radius.index_status).toBe('partial');
    expect(radius.degraded).toBe(true);
    expect(radius.reason).toBe('index_partial');
    expect(radius.summary.toLowerCase()).toContain('partial');
  });

  it('BlastResult.degraded === true (ripgrep fallback) → index_status degraded, reason forwarded verbatim', () => {
    const radius = buildBlastRadius(
      emptyResult({ degraded: true, reason: 'repo_too_large' }),
      FULL, // even if indexState says full, a degraded BlastResult wins
    );
    expect(radius.index_status).toBe('degraded');
    expect(radius.degraded).toBe(true);
    expect(radius.reason).toBe('repo_too_large');
  });

  it('indexState === null → failed + degraded:true, never full', () => {
    const radius = buildBlastRadius(emptyResult({ degraded: false }), null);
    expect(radius.index_status).toBe('failed');
    expect(radius.degraded).toBe(true);
    expect(radius.reason).toBe('index_failed');
  });

  it('KEY NEGATIVE TEST: identical empty downstream on full vs partial index yields different responses', () => {
    const full = buildBlastRadius(emptyResult({ degraded: false }), FULL);
    const partial = buildBlastRadius(emptyResult({ degraded: false }), PARTIAL);

    expect(full.downstream).toEqual(partial.downstream); // both empty arrays
    expect(full.degraded).not.toBe(partial.degraded);
    expect(full.reason).not.toBe(partial.reason);
    expect(full.summary).not.toBe(partial.summary);
  });
});

describe('buildBlastRadius — indexed_sha and staleness', () => {
  const INDEXED: IndexStateLike = { status: 'full', lastIndexedSha: 'sha-old' };

  it('reports the sha the index was built from, not the PR head', () => {
    const radius = buildBlastRadius(emptyResult(), INDEXED, 'sha-head');
    expect(radius.indexed_sha).toBe('sha-old');
  });

  it('index_stale is true when the indexed sha differs from the PR head', () => {
    const radius = buildBlastRadius(emptyResult(), INDEXED, 'sha-head');
    expect(radius.index_stale).toBe(true);
    // Staleness surfaces in the summary even though the index itself is FULL —
    // an intact index answering about an older commit still misreports this PR.
    expect(radius.index_status).toBe('full');
    expect(radius.degraded).toBe(false);
    expect(radius.summary).toMatch(/earlier commit/i);
  });

  it('index_stale is false when the index is current', () => {
    const radius = buildBlastRadius(emptyResult(), INDEXED, 'sha-old');
    expect(radius.index_stale).toBe(false);
    expect(radius.summary).not.toMatch(/earlier commit/i);
  });

  // Never assert a staleness we did not observe: an unknown sha on either side
  // is "could not compare", which must not be reported as "out of date".
  it('an unknown sha on either side is not-stale, never guessed', () => {
    expect(buildBlastRadius(emptyResult(), INDEXED).index_stale).toBe(false);
    expect(buildBlastRadius(emptyResult(), FULL, 'sha-head').index_stale).toBe(false);
    expect(buildBlastRadius(emptyResult(), null, 'sha-head').index_stale).toBe(false);
  });

  // `getIndexState` synthesises lastIndexedSha: '' for "no index at all"
  // (repo-intel/service.ts). An empty string is an absence, not a commit — a
  // consumer must not build a deep-link against it.
  it("the synthesised empty sha of a missing index becomes null, not ''", () => {
    const radius = buildBlastRadius(
      emptyResult(),
      { status: 'degraded', lastIndexedSha: '' },
      'sha-head',
    );
    expect(radius.indexed_sha).toBeNull();
    expect(radius.index_stale).toBe(false);
  });

  it('a stale index still reports its real counts alongside the warning', () => {
    const radius = buildBlastRadius(
      {
        changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
        callers: [{ file: 'b.ts', symbol: 'bar', viaSymbol: 'foo', line: 7, rank: 1 }],
        impactedEndpoints: [],
        factsByFile: {},
      },
      INDEXED,
      'sha-head',
    );
    expect(radius.summary).toMatch(/earlier commit/i);
    expect(radius.summary).toMatch(/1 caller/);
    expect(radius.downstream).toHaveLength(1);
  });
});
