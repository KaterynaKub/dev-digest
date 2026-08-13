import type { DownstreamImpact } from "@devdigest/shared";
import {
  CALLER_COLUMN_X,
  MAX_CALLER_NODES_PER_SYMBOL,
  MAX_SYMBOL_NODES,
  ROW_HEIGHT,
  SYMBOL_COLUMN_X,
  TOP_PADDING,
} from "./constants";

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
}

export interface GraphLayout {
  symbolNodes: GraphNode[];
  callerNodes: GraphNode[];
  edges: GraphEdge[];
  /** Height of the SVG coordinate space, derived from the row count. */
  height: number;
  /** Symbols beyond `MAX_SYMBOL_NODES`, folded away — never rendered as nodes. */
  hiddenSymbolCount: number;
  /** Per-symbol caller counts beyond `MAX_CALLER_NODES_PER_SYMBOL`, keyed by symbol id. */
  hiddenCallerCountBySymbol: Record<string, number>;
}

/**
 * Two-layer deterministic layout: changed symbols in a left column, their
 * callers in a right column, one row per caller. Deliberately NOT
 * force-directed — a force simulation is order/seed-dependent, and this
 * layout must reproduce byte-identical geometry from the same sorted
 * `downstream[]` input (spec 0007-blast-radius.md §4.5 / §6.2).
 *
 * `downstream` is assumed already sorted by the server (helpers.ts on the
 * server side); this function does not re-sort, only truncates — re-sorting
 * here would risk silently disagreeing with the server's tie-break rules.
 */
export function buildBlastGraphLayout(downstream: DownstreamImpact[]): GraphLayout {
  const visibleSymbols = downstream.slice(0, MAX_SYMBOL_NODES);
  const hiddenSymbolCount = Math.max(0, downstream.length - visibleSymbols.length);

  const symbolNodes: GraphNode[] = [];
  const callerNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const hiddenCallerCountBySymbol: Record<string, number> = {};

  let row = 0;

  for (const symbol of visibleSymbols) {
    const symbolId = `sym:${symbol.symbol}`;
    const visibleCallers = symbol.callers.slice(0, MAX_CALLER_NODES_PER_SYMBOL);
    const hiddenCallers = Math.max(0, symbol.callers.length - visibleCallers.length);
    if (hiddenCallers > 0) {
      hiddenCallerCountBySymbol[symbol.symbol] = hiddenCallers;
    }

    // A symbol with zero visible callers still gets one row so it appears
    // in the graph (matches the Tree view, which lists every downstream
    // entry it has).
    const rowsForSymbol = Math.max(1, visibleCallers.length);
    const symbolRowStart = row;
    const symbolCenterY = TOP_PADDING + (symbolRowStart + (rowsForSymbol - 1) / 2) * ROW_HEIGHT;

    symbolNodes.push({
      id: symbolId,
      label: symbol.symbol,
      x: SYMBOL_COLUMN_X,
      y: symbolCenterY,
    });

    visibleCallers.forEach((caller, i) => {
      const callerId = `caller:${symbol.symbol}:${caller.file}:${caller.line}:${i}`;
      const y = TOP_PADDING + (row + i) * ROW_HEIGHT;
      callerNodes.push({
        id: callerId,
        label: caller.name,
        x: CALLER_COLUMN_X,
        y,
      });
      edges.push({ id: `edge:${symbolId}->${callerId}`, fromId: symbolId, toId: callerId });
    });

    row += rowsForSymbol;
  }

  const height = TOP_PADDING * 2 + Math.max(1, row) * ROW_HEIGHT;

  return {
    symbolNodes,
    callerNodes,
    edges,
    height,
    hiddenSymbolCount,
    hiddenCallerCountBySymbol,
  };
}
