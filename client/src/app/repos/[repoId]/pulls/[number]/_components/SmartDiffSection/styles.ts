import type { CSSProperties } from "react";

/** Tooltip geometry. Same z-index band as `FindingsHoverPanel`'s
 *  `PANEL_Z_INDEX` — above Dropdown (40), below Drawer/Modal (50). */
export const TOOLTIP_MAX_WIDTH = 380;
export const TOOLTIP_OFFSET = 6;
export const TOOLTIP_Z_INDEX = 45;
export const VIEWPORT_MARGIN = 8;
/** Lifts the diff row that owns an open tooltip above its sibling rows. Small on
 *  purpose — it only has to beat its siblings (which have no z-index at all), not
 *  the app's overlay bands. */
export const ROW_TOOLTIP_Z_INDEX = 2;
/** Rationale is markdown of unbounded length — clamp it; the Findings tab is
 *  where the full text lives. */
export const TOOLTIP_RATIONALE_LINES = 5;

/** Co-located styles for SmartDiffSection. Longhand border properties wherever
 *  `is_large` changes the colour — mixing the `border` shorthand with a
 *  conditional `borderColor` silently loses one of them in React's style merging. */
export const s = {
  section: { marginBottom: 24 } satisfies CSSProperties,
  statsRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  toggleWrap: {
    marginLeft: "auto",
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toggleButton: (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),

  splitCallout: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "12px 14px",
    marginBottom: 12,
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,

  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 2px 6px",
    cursor: "pointer",
  } satisfies CSSProperties,
  groupChip: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  groupName: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupCaption: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupEmpty: { fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" } satisfies CSSProperties,

  fileCard: (isLarge: boolean): CSSProperties => ({
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: isLarge ? "var(--warn)" : "var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  }),
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingsDotWrap: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  findingsDot: (color: string): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 99,
    background: color,
  }),
  fileStat: { fontSize: 12, flexShrink: 0 } satisfies CSSProperties,

  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  // Copied from diff-viewer/styles.ts (deliberate — see SmartDiffSection.tsx
  // header comment) rather than imported, since they are plain objects and
  // copying keeps the shared module's surface unchanged.
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,

  /** Extras layered onto `lineRowFor(kind)` for a line covered by a finding
   *  block: the severity stripe plus a full-row tint. The tint is a
   *  `backgroundImage` overlay, not `background`, so it composites ON TOP of the
   *  row's own add/del colour that `lineRowFor` already put in `background` —
   *  assigning `background` here would erase it and a marked `+` line would stop
   *  looking like an addition.
   *
   *  `position: relative` is what lets the badge be absolutely positioned
   *  against this row (see `markBadgeSlot`) and so stay out of the row's height
   *  calculation entirely. */
  markLineExtra: (
    color: string,
    tint: string,
    edge: string,
    edges: { isBlockStart: boolean; isBlockEnd: boolean },
  ): CSSProperties => ({
    position: "relative",
    borderLeftStyle: "solid",
    borderLeftWidth: 2,
    borderLeftColor: color,
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
    // Hairline rules at a block's first and last row. Without them two findings
    // of the same severity that touch (or nest) merge into one band and the
    // reader cannot tell where one ends and the next begins. `inset` box-shadows
    // rather than borders: a border would change the row's box and reintroduce
    // exactly the 1px height drift `markBadgeSlot` exists to prevent.
    boxShadow: blockEdgeShadow(edge, edges),
    transition: "background-image .12s",
  }),

  /**
   * Badge slot — absolutely positioned so a row carrying a finding is EXACTLY as
   * tall as a plain row. Previously the Badge sat in the flex row as a normal
   * child, and its own `padding: 2px 10px` + `lineHeight: 1.4` at `fontSize: 12`
   * measured taller than the row's `lineHeight: "20px"`, so every finding row
   * was visibly taller than its neighbours and the diff lost its even rhythm.
   *
   * Out of flow it cannot push the row's height at all; `top: 0; bottom: 0` plus
   * `align-items: center` keeps it vertically centred on the 20px row whatever
   * the badge's intrinsic height is.
   */
  markBadgeSlot: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    // NO `zIndex` here, deliberately. A z-index on a positioned element creates
    // a stacking context, and the tooltip renders inside this slot — so its own
    // `z-index: 45` would be resolved only WITHIN the slot, leaving the whole
    // slot to be painted as one layer. The next row's slot (same z-index, later
    // in the DOM) then won outright and its badge drew ON TOP of the tooltip.
    // None of it is needed: this element is positioned and the row's text is
    // not, so it already paints above the text by normal painting order.
  } satisfies CSSProperties,

  /** Per-badge wrapper — owns the hover that opens the tooltip. Inline-flex so
   *  it hugs the badge exactly, making the rect it reports the badge's own. */
  markBadgeWrap: { display: "inline-flex", alignItems: "center" } satisfies CSSProperties,

  /**
   * Applied to the one row whose tooltip is currently open, so the tooltip is
   * not painted over by the rows below it.
   *
   * Every covered row is `position: relative` (see `markLineExtra`), and equally
   * positioned siblings paint in DOM order — so the NEXT row and its badge drew
   * on top of this row's tooltip. This `z-index` is what puts the whole row (and
   * the tooltip inside it) above its siblings; it is applied only while a tooltip
   * is open, so the diff has no permanent stacking layers.
   */
  rowWithOpenTooltip: { zIndex: ROW_TOOLTIP_Z_INDEX } satisfies CSSProperties,

  /** Scales the Badge down onto a 20px row: the badge keeps its shape, but its
   *  box can no longer exceed the row. Paired with `markBadgeSlot`, which has
   *  already taken it out of flow — this is purely about how it LOOKS on a
   *  dense diff, not about the row height (that is already guaranteed). */
  markBadgeCompact: {
    padding: "0 8px",
    fontSize: 11,
    lineHeight: "16px",
  } satisfies CSSProperties,

  /**
   * Deliberately NOT `animation: ddpop` (which the kit's other popovers use):
   * `ddpop` animates `opacity` 0 → 1, and a tooltip caught mid-fade let the diff
   * text and the next badge show straight through it — over dense monospace code
   * that made the tooltip unreadable. Its `transform` is a second reason: a
   * transform on a `position: fixed` element makes it a containing block, which
   * would break the viewport-relative placement this tooltip depends on.
   *
   * `--bg-elevated` is itself fully opaque in both themes, so with the animation
   * gone the panel is too — nothing behind it bleeds through.
   */
  tooltip: {
    position: "fixed",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "9px 11px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    boxShadow: "var(--shadow-modal)",
    zIndex: TOOLTIP_Z_INDEX,
    // A tooltip is a preview, never a click target — it must not eat the hover
    // it was opened by, nor block the row underneath it.
    pointerEvents: "none",
  } satisfies CSSProperties,

  tooltipTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.35,
  } satisfies CSSProperties,

  tooltipRationale: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    // Plain text with a line clamp, matching FindingsHoverPanel#itemRationale:
    // `rationale` is markdown, and rendering it here would fight the clamp.
    display: "-webkit-box",
    WebkitLineClamp: TOOLTIP_RATIONALE_LINES,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,

  // Button reset for the mark badge when it navigates (onGoToFinding
  // supplied) — longhand border, no new colour, inherits the Badge's own look.
  markButton: {
    background: "none",
    borderStyle: "none",
    padding: 0,
    cursor: "pointer",
    display: "inline-flex",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
} as const;

/**
 * `inset` box-shadow hairlines marking where a finding block begins and ends.
 * Returns `undefined` (not `"none"`) for an interior row so React omits the
 * property entirely rather than writing a value that would override nothing.
 *
 * `edge` is a translucent rgba of the severity hue (the caller passes
 * `SEVERITY_ROW_BG_HOVER`), NOT the solid `var(--crit)`: at full strength the
 * rule reads as a table border and chops the block into separate rows, which is
 * the opposite of the "this is one finding" the tint works to establish.
 */
function blockEdgeShadow(
  edge: string,
  { isBlockStart, isBlockEnd }: { isBlockStart: boolean; isBlockEnd: boolean },
): string | undefined {
  const rules: string[] = [];
  if (isBlockStart) rules.push(`inset 0 1px 0 0 ${edge}`);
  if (isBlockEnd) rules.push(`inset 0 -1px 0 0 ${edge}`);
  return rules.length > 0 ? rules.join(", ") : undefined;
}

/** Chevron rotates 90deg when open — same idiom as diff-viewer/styles.ts#chevronFor. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
