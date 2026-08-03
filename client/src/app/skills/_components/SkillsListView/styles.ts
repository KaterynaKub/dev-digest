import type { CSSProperties } from "react";

/** Co-located styles for SkillsListView.

    The page fills the shell's viewport and scrolls its two columns
    independently (list left, detail right) rather than scrolling as one
    document — the detail pane's tab bar must stay reachable while a long
    skill list scrolls. Hence `height: 100%` + `minHeight: 0` on the flex
    children, the standard fix for nested-flex overflow. */
export const s = {
  page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } satisfies CSSProperties,
  layout: { display: "flex", flex: 1, minHeight: 0, alignItems: "stretch" } satisfies CSSProperties,

  /* --- Left column: header + search + card list --- */
  listCol: {
    width: 340,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  listHead: { padding: "20px 18px 12px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h1: { flex: 1, fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 11px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    background: "transparent",
    border: "none",
    outline: "none",
    minWidth: 0,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  listScroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 20px" } satisfies CSSProperties,
  grid: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  /* --- Right column: skill detail --- */
  detailCol: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", background: "var(--bg-primary)" } satisfies CSSProperties,
} as const;
