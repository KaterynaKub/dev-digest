import type { CSSProperties } from "react";

/** Co-located styles for AddSkillDrawer. */
export const s = {
  pickWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "40px 24px",
    border: "1px dashed var(--border-strong)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  pickLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 16px",
    borderRadius: 7,
    background: "var(--accent)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  pickHint: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  // Visually hidden but still focusable/accessible — the classic "sr-only"
  // pattern, avoids `display:none` which drops it from the a11y tree.
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
  notice: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  sourceEntry: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 16,
  } satisfies CSSProperties,
  error: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    border: "1px solid var(--crit)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
} as const;
