/**
 * Tuning constants for the MCP tools module. Plain literals — no I/O, no
 * dependency on any other module (layer boundary keeps this a leaf).
 */

/** Upper bound for `run_agent_on_pr` — "wait for the result" (principle #1). */
export const RUN_TIMEOUT_MS = 300_000;

/** `get_findings`/`run_agent_on_pr` default response cap (CONCISE format). */
export const FINDINGS_LIMIT_CONCISE = 20;

/** `get_findings` DETAILED format cap. */
export const FINDINGS_LIMIT_DETAILED = 50;

/** `compactFinding().rationale` truncation length. */
export const RATIONALE_MAX_CHARS = 400;

/**
 * Registration order for `server-factory.ts` — a fixed literal array, not
 * `Object.values()` over a map, so `tools/list` returns a STABLE order across
 * restarts (constraint: prompt-cache hit rate for the client's tool listing).
 */
export const TOOL_NAMES = [
  'list_agents',
  'run_agent_on_pr',
  'get_findings',
  'get_conventions',
  'get_blast_radius',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
