/**
 * 0007 — BlastGraph layout limits. Kept tiny and independent of viewport size:
 * the SVG uses a fixed coordinate system and scales down via `viewBox`, so
 * these are node COUNTS, not pixels.
 */

/** Symbol nodes rendered in the left column before folding the rest into "+N more". */
export const MAX_SYMBOL_NODES = 6;

/** Caller nodes rendered per symbol before folding the rest into "+N more". */
export const MAX_CALLER_NODES_PER_SYMBOL = 5;

/** Fixed SVG coordinate-space size; scales to the container via viewBox. */
export const SVG_WIDTH = 640;
export const ROW_HEIGHT = 34;
export const TOP_PADDING = 20;
export const SYMBOL_COLUMN_X = 90;
export const CALLER_COLUMN_X = 420;
export const NODE_RADIUS = 5;
