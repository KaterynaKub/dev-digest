import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard. `overflow-wrap`/`word-break` on the
 *  long-content rows below is the required companion to OverviewTab's
 *  `gridItem` `minWidth: 0` (spec §6.7): resetting the grid item's width
 *  floor only helps if this card's own long content (file paths, endpoint
 *  badges, symbol names) has somewhere to break — otherwise it overflows the
 *  50% column horizontally instead of the column stretching past 50%, which
 *  is a different bug, not a fix. */
export const s = {
  wrap: {
    padding: "16px 18px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  toggleWrap: {
    marginLeft: "auto",
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toggleButton: (active: boolean, disabled?: boolean): CSSProperties => ({
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: disabled ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-muted)",
    opacity: disabled ? 0.5 : 1,
  }),
  loadingLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  errorWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  degradedBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--warn, #b45309)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 12,
  } satisfies CSSProperties,
  degradedBannerText: { flex: 1 } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  symbolRow: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    cursor: "pointer",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  symbolName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  symbolKind: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolCallers: {
    padding: "4px 10px 10px 30px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  callerRow: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  callerFile: { color: "var(--text-muted)" } satisfies CSSProperties,
  factsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  } satisfies CSSProperties,
  /** Overrides Badge's default `whiteSpace: "nowrap"` — endpoint/cron badges
   *  carry file-path-length text (`GET /api/public/items`) that must wrap
   *  inside the 50% column rather than pushing it wider (spec §6.7). */
  factBadge: {
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when open — same idiom as SmartDiffSection/styles.ts#chevronFor. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
