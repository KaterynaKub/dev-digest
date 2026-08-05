import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  label: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  select: { width: 260, minWidth: 0 } satisfies CSSProperties,
  defaultTag: {
    fontSize: 10.5,
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 5px",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /* Shown instead of the picker when the live model list is unavailable. The
     scan itself is never blocked — it just runs on the default. */
  note: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    maxWidth: 260,
    lineHeight: 1.4,
  } satisfies CSSProperties,
};
