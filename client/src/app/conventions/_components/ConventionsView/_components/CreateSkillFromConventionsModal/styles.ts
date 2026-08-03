import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  enabledWrap: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  enabledRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  enabledLabel: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 } satisfies CSSProperties,

  /* Body editor gets a file strip so the textarea reads as an editor pane —
     same idiom as the skill detail Config tab. */
  bodyBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  bodyBar: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyFile: { fontSize: 12 } satisfies CSSProperties,
  tokens: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
  } satisfies CSSProperties,
  footerNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
  } satisfies CSSProperties,
};
