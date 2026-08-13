import type { CSSProperties } from "react";

/** Co-located styles for BlastGraph. Theme via CSS variables only — no hex. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  svg: {
    width: "100%",
    height: "auto",
    display: "block",
  } satisfies CSSProperties,
  edge: {
    stroke: "var(--border)",
    strokeWidth: 1,
    fill: "none",
  } satisfies CSSProperties,
  symbolNode: {
    fill: "var(--accent, var(--text-primary))",
  } satisfies CSSProperties,
  callerNode: {
    fill: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolLabel: {
    fill: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 600,
  } satisfies CSSProperties,
  callerLabel: {
    fill: "var(--text-secondary)",
    fontSize: 11.5,
  } satisfies CSSProperties,
  moreLine: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
