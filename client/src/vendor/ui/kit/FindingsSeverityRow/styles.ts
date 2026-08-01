import type { CSSProperties } from "react";

/** Panel geometry — also used to decide whether to flip above the trigger. */
export const PANEL_WIDTH = 380;
export const PANEL_MAX_HEIGHT = 380;
/** Max height of the scrolling item list (the header stays pinned). */
export const LIST_MAX_HEIGHT = 300;
/** Grace period so the pointer can travel from the chips into the panel. */
export const CLOSE_DELAY_MS = 140;
/** Gap between trigger and panel. Kept small — the panel adds its own padding. */
export const PANEL_OFFSET = 6;
/** Above Dropdown (40), below Drawer/Modal (50). */
export const PANEL_Z_INDEX = 45;
/** Viewport edge padding when clamping the panel horizontally. */
export const VIEWPORT_MARGIN = 8;

export const s = {
  wrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,

  /**
   * Icon + count over a severity-coloured underline (per the design), rather
   * than the filled pill SeverityBadge renders. The underline doubles as the
   * filter-state affordance: it thickens and goes opaque when active, so the
   * selected severity reads without relying on colour alone.
   */
  chipButton: (color: string, active: boolean, dimmed: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    padding: "1px 2px 3px",
    cursor: "pointer",
    color,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    borderBottom: `${active ? 2 : 1}px solid ${color}`,
    opacity: dimmed ? 0.4 : active ? 1 : 0.85,
    transition: "opacity .1s, border-bottom-width .1s",
  }),

  chipCount: { fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,

  panel: (top: number, left: number): CSSProperties => ({
    // `fixed` (not absolute) so the panel escapes the PR table card's
    // `overflow: hidden` without needing a portal.
    position: "fixed",
    top,
    left,
    width: PANEL_WIDTH,
    maxHeight: PANEL_MAX_HEIGHT,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    zIndex: PANEL_Z_INDEX,
    animation: "ddpop .12s ease",
    overflow: "hidden",
  }),

  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px 8px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  filterHint: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 0,
    textTransform: "none",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  list: {
    maxHeight: LIST_MAX_HEIGHT,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  item: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  itemTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,

  itemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  } satisfies CSSProperties,

  itemMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,

  /**
   * The file:line link is the only elastic cell in the meta row, so it takes
   * the ellipsis while ConfidenceNum keeps its intrinsic width. `minWidth: 0`
   * is what actually lets a flex child shrink below its content width.
   */
  itemMetaPath: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  itemRationale: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    // Plain text, not <Markdown>: block <p> elements fight -webkit-line-clamp
    // and a server-truncated markdown string can be syntactically broken.
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,

  empty: {
    padding: "14px 12px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  footer: {
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
