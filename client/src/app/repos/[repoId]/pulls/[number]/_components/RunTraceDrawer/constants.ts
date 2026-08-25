/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Prompt-assembly block accent colours (by leg). */
/* Per-run outcome of one attached project-context document (AC-56). Only
   `injected` means the document actually reached the prompt; the other three
   are degradations the trace must not hide behind an identical-looking path. */
export const SPEC_STATUS_COLORS = {
  injected: "var(--ok)",
  truncated: "var(--warn)",
  dropped_budget: "var(--warn)",
  missing: "var(--danger)",
} as const;

export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;
