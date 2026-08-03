import type { CSSProperties } from "react";

export const s = {
  /* A rejected card stays in the DOM at reduced opacity: "Reject all" must
     read as undoable, not as data loss. */
  card: (rejected: boolean): CSSProperties => ({
    padding: 16,
    opacity: rejected ? 0.55 : 1,
    transition: "opacity .2s ease",
  }),
  row: { display: "flex", gap: 16, alignItems: "flex-start" } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  } satisfies CSSProperties,
  rule: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  } satisfies CSSProperties,
  confidenceLabel: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  bar: { width: 96 } satisfies CSSProperties,
  percent: { fontSize: 11.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 150,
    flexShrink: 0,
  } satisfies CSSProperties,
};
