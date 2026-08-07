/** Co-located constants for SmartDiffSection. */
import type { SmartDiffRole, Severity } from "@devdigest/shared";

/** Group-level expansion default — literal per constraint: `boilerplate` is
 *  ALWAYS closed, even when it is the only non-empty group. */
export const GROUP_DEFAULT_OPEN: Record<SmartDiffRole, boolean> = {
  core: true,
  wiring: true,
  boilerplate: false,
};

/** Fixed order the three group headers render in — matches the API's group order. */
export const GROUP_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Colour chip per role — closest existing tokens, no new CSS variable. */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

/** Severity colour for the findings dot / mark stripe / mark badge. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};

export const SEVERITY_BG: Record<Severity, string> = {
  CRITICAL: "var(--crit-bg)",
  WARNING: "var(--warn-bg)",
  SUGGESTION: "var(--sugg-bg)",
};
