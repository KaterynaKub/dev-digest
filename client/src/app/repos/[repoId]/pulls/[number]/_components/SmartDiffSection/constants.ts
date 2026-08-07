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

/** Severity precedence — lower is worse. Mirrors the server's own SEVERITY_RANK
 *  (`server/src/modules/smart-diff/constants.ts`) and `worstSeverityOf`'s order;
 *  used to resolve which tint wins when two findings cover the same row. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
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

/** Marked-line row tint — the whole row, not just the badge, so the reviewer
 *  spots a flagged line while scanning. Deliberately literal rgba rather than
 *  the `--*-bg` tokens: those sit at 0.12/0.08 alpha, which reads as a badge
 *  chip but disappears once it has to compete with the row's own
 *  `--code-add`/`--code-del` tint underneath. Both stops share one hue per
 *  severity so hover reads as "the same row, brighter", never as a colour change.
 *  Values are theme-independent on purpose — they are translucent overlays and
 *  land correctly on both the dark and light `--bg-surface`. */
export const SEVERITY_ROW_BG: Record<Severity, string> = {
  CRITICAL: "rgba(239, 68, 68, 0.13)",
  WARNING: "rgba(245, 158, 11, 0.13)",
  SUGGESTION: "rgba(59, 130, 246, 0.13)",
};

/** Same hue as SEVERITY_ROW_BG, roughly double the alpha — the hover step. */
export const SEVERITY_ROW_BG_HOVER: Record<Severity, string> = {
  CRITICAL: "rgba(239, 68, 68, 0.24)",
  WARNING: "rgba(245, 158, 11, 0.24)",
  SUGGESTION: "rgba(59, 130, 246, 0.24)",
};
