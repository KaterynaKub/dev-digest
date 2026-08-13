import type { BlastCaller, BlastRadius, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';
import { MAX_CALLERS_PER_SYMBOL, MAX_DOWNSTREAM_SYMBOLS, MAX_ENDPOINTS_PER_SYMBOL } from './constants.js';

/**
 * 0007 — blast pure helpers. No `await`, no `this`, no I/O. The only new
 * logic this module adds: flat `BlastResult` (per-caller) → grouped
 * `BlastRadius` (per-changed-symbol), plus the index-state mapping that
 * keeps "no downstream" (a fact) distinguishable from "index incomplete" (a
 * state) — see `specs/0007-blast-radius.md` §4.2/§4.5.
 */

/** Structural mirror of `repo-intel/types.ts#BlastCallerRow` — no import from repo-intel/**. */
export interface BlastCallerRowLike {
  file: string;
  symbol: string;
  viaSymbol: string;
  line: number;
  rank: number;
}

/** Structural mirror of `repo-intel/types.ts#BlastChangedSymbol`. */
export interface BlastChangedSymbolLike {
  file: string;
  name: string;
  kind: string;
}

/** Structural mirror of `repo-intel/types.ts#BlastResult`. */
export interface BlastResultLike {
  changedSymbols: BlastChangedSymbolLike[];
  callers: BlastCallerRowLike[];
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: string;
}

/** Structural mirror of `repo-intel/types.ts#IndexState`, narrowed to what this helper reads. */
export interface IndexStateLike {
  status: 'full' | 'partial' | 'degraded' | 'failed';
}

const EMPTY_FACTS = { endpoints: [] as string[], crons: [] as string[] };

/**
 * Index-status mapping — table in `specs/0007-blast-radius.md` §4.2. Decided
 * BEFORE grouping so `summary` can describe the map honestly regardless of
 * whether `downstream` ends up empty.
 */
function resolveIndexState(
  result: BlastResultLike,
  indexState: IndexStateLike | null,
): { index_status: BlastRadius['index_status']; degraded: boolean; reason: string | null } {
  // The facade could not even attempt a read (threw, or no index at all).
  if (indexState === null) {
    return { index_status: 'failed', degraded: true, reason: 'index_failed' };
  }

  // Ripgrep/best-effort fallback — always `degraded: true` from the facade,
  // and never carries a persistent `state.status` worth trusting for "full".
  if (result.degraded) {
    return { index_status: 'degraded', degraded: true, reason: result.reason ?? 'no_data' };
  }

  // Persistent path succeeded. `state.status` is the only place 'partial' is
  // observable — `BlastResult` itself never carries it (see §4.2, §10.3).
  if (indexState.status === 'partial') {
    return { index_status: 'partial', degraded: true, reason: 'index_partial' };
  }
  if (indexState.status === 'full') {
    return { index_status: 'full', degraded: false, reason: null };
  }

  // Defensive: an indexState of 'degraded'/'failed' alongside a non-degraded
  // BlastResult shouldn't happen, but never invent 'full' from it.
  return { index_status: indexState.status, degraded: true, reason: 'index_failed' };
}

/** Lexicographic ascending string compare — used for every last tie-break. */
function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pure transform: `BlastResult` (flat, per-caller) → `BlastRadius` (grouped
 * per changed symbol, with an explicit index state). Sorting is total —
 * every comparator ends in a lexicographic tie-break — so two calls with the
 * same input in a different order produce a byte-identical result.
 */
export function buildBlastRadius(result: BlastResultLike, indexState: IndexStateLike | null): BlastRadius {
  const { index_status, degraded, reason } = resolveIndexState(result, indexState);

  const changed_symbols: ChangedSymbol[] = result.changedSymbols
    .map((s) => ({ file: s.file, name: s.name, kind: s.kind }))
    .sort((a, b) => byString(a.name, b.name) || byString(a.file, b.file));

  // Group callers per changed symbol (`viaSymbol`).
  const callersBySymbol = new Map<string, BlastCallerRowLike[]>();
  for (const c of result.callers) {
    const arr = callersBySymbol.get(c.viaSymbol);
    if (arr) arr.push(c);
    else callersBySymbol.set(c.viaSymbol, [c]);
  }

  const hasFactsByFile = result.factsByFile != null;

  const downstream: DownstreamImpact[] = [];
  for (const [symbol, rows] of callersBySymbol) {
    const sortedCallers = [...rows].sort(
      (a, b) => b.rank - a.rank || byString(a.file, b.file) || (a.line - b.line),
    );

    const callers: BlastCaller[] = sortedCallers
      .slice(0, MAX_CALLERS_PER_SYMBOL)
      .map((c) => ({ name: c.symbol, file: c.file, line: c.line }));

    // Attribution: only from `factsByFile`, keyed by the UNIQUE caller files
    // of THIS symbol — never a flat union of `impactedEndpoints` across all
    // symbols. When `factsByFile` is absent (degraded/ripgrep path), this
    // symbol gets no endpoints/crons at all — precision over completeness,
    // per §4.5 step 2.
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    if (hasFactsByFile) {
      const callerFiles = new Set(rows.map((c) => c.file));
      for (const file of callerFiles) {
        const facts = result.factsByFile?.[file] ?? EMPTY_FACTS;
        for (const e of facts.endpoints) endpoints.add(e);
        for (const c of facts.crons) crons.add(c);
      }
    }

    downstream.push({
      symbol,
      callers,
      endpoints_affected: [...endpoints].sort(byString).slice(0, MAX_ENDPOINTS_PER_SYMBOL),
      crons_affected: [...crons].sort(byString).slice(0, MAX_ENDPOINTS_PER_SYMBOL),
    });
  }

  // Total order: caller count desc, then max rank desc, then symbol name asc.
  downstream.sort((a, b) => {
    if (b.callers.length !== a.callers.length) return b.callers.length - a.callers.length;
    const rankA = Math.max(0, ...(callersBySymbol.get(a.symbol) ?? []).map((c) => c.rank));
    const rankB = Math.max(0, ...(callersBySymbol.get(b.symbol) ?? []).map((c) => c.rank));
    if (rankB !== rankA) return rankB - rankA;
    return byString(a.symbol, b.symbol);
  });

  const trimmedDownstream = downstream.slice(0, MAX_DOWNSTREAM_SYMBOLS);

  const summary = buildSummary(changed_symbols.length, trimmedDownstream, index_status);

  return {
    changed_symbols,
    downstream: trimmedDownstream,
    summary,
    index_status,
    degraded,
    reason,
  };
}

/**
 * Deterministic, arithmetic summary — never a model call. Must say honestly
 * when the map is built on incomplete data rather than reporting zeros as a
 * fact (§4.5 step 7 / §9 acceptance criteria).
 */
function buildSummary(
  symbolCount: number,
  downstream: DownstreamImpact[],
  indexStatus: BlastRadius['index_status'],
): string {
  if (indexStatus === 'degraded' || indexStatus === 'failed') {
    return 'Index not built — downstream unavailable.';
  }
  if (indexStatus === 'partial') {
    return 'Index is partial — downstream may be incomplete.';
  }

  // index_status === 'full' from here on.
  if (downstream.length === 0) {
    return symbolCount === 0
      ? 'No changed symbols detected.'
      : `${symbolCount} changed symbol${symbolCount === 1 ? '' : 's'} · no downstream callers found.`;
  }

  const callerCount = downstream.reduce((sum, d) => sum + d.callers.length, 0);
  const files = new Set<string>();
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  for (const d of downstream) {
    for (const c of d.callers) files.add(c.file);
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }

  const parts = [
    `${symbolCount} changed symbol${symbolCount === 1 ? '' : 's'}`,
    `${callerCount} caller${callerCount === 1 ? '' : 's'} across ${files.size} file${files.size === 1 ? '' : 's'}`,
  ];
  if (endpoints.size > 0) parts.push(`${endpoints.size} endpoint${endpoints.size === 1 ? '' : 's'}`);
  if (crons.size > 0) parts.push(`${crons.size} cron${crons.size === 1 ? '' : 's'}`);

  return parts.join(' · ');
}
