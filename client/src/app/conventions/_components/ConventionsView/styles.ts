import type { CSSProperties } from "react";

export const s = {
  /* The shell's <main> has no padding of its own, so every page supplies its
     own gutters — same idiom as AgentsListView. */
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 6,
  } satisfies CSSProperties,
  headMain: { minWidth: 0 } satisfies CSSProperties,
  h1: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  headActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  subtitle: {
    margin: "6px 0 0",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bulkBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "18px 0",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  skeletons: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    marginTop: 18,
  } satisfies CSSProperties,
};
