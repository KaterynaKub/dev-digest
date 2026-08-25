/**
 * 0007 — BlastRadiusCard constants. `index_status` values that count as
 * "the map is trustworthy" vs "the map is a best-effort / missing state".
 */

/** `index_status` values that render the degraded banner instead of the tree/empty state. */
export const DEGRADED_INDEX_STATUSES = new Set(['partial', 'degraded', 'failed']);
