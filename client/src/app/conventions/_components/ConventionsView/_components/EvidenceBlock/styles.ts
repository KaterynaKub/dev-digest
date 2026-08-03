import type { CSSProperties } from "react";

/* Evidence block — a file-strip header (path:lines + copy) over a code pane.
   Mirrors the SkillDetail bodyBox/bodyBar idiom so a snippet reads as a code
   surface rather than a quote. */
export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--code-bg, var(--bg-elevated))",
  } satisfies CSSProperties,
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 11px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  path: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  copyBtn: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.55,
    // Wide snippets scroll inside their own box; the page never scrolls
    // horizontally because of one long line of evidence.
    overflowX: "auto",
    whiteSpace: "pre",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
};
