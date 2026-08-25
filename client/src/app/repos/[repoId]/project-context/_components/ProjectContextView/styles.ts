import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextView. Two-column persistent layout —
    document list left, preview/edit right, status line pinned at the bottom
    of the list column — same nested-flex-overflow shape as SkillsListView's
    `styles.ts` (see its own doc comment for why `minHeight: 0` matters here). */
export const s = {
  page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } satisfies CSSProperties,
  layout: { display: "flex", flex: 1, minHeight: 0, alignItems: "stretch" } satisfies CSSProperties,

  /* --- Left column: doc list + status line --- */
  listCol: {
    width: 300,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  listHead: { padding: "18px 16px 10px" } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  listScroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 10px" } satisfies CSSProperties,
  docRow: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 7,
    border: "none",
    background: active ? "var(--bg-elevated)" : "transparent",
    cursor: "pointer",
    textAlign: "left",
  }),
  docRowPath: (active: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),

  statusLine: {
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  statusMain: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statusDot: (color: string): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 99,
    background: color,
    flexShrink: 0,
  }),
  statusNote: { fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 } satisfies CSSProperties,

  /* --- Right column: preview / edit --- */
  detailCol: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  detailHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 24px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  detailPath: { fontSize: 14, fontWeight: 650, letterSpacing: "-0.01em" } satisfies CSSProperties,
  detailHeadSpacer: { flex: 1 } satisfies CSSProperties,
  detailScroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" } satisfies CSSProperties,
  uncommittedNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--warn)",
    marginBottom: 14,
  } satisfies CSSProperties,
  editActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 24px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  saveError: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
} as const;
