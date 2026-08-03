import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--bg-hover)" : "var(--bg-surface)",
    cursor: "pointer",
    // Disabled skills stay legible but visibly inert — they never reach a prompt.
    opacity: enabled ? 1 : 0.6,
    transition: "border-color .12s, background .12s, opacity .12s",
    overflow: "hidden",
  }),
  main: { display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 9 } satisfies CSSProperties,
  icon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  name: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: 650,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  description: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  sourceRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /* Stats strip is separated by a hairline so the card reads as
     "identity above / measurement below", matching the design. */
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "7px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statSoon: { fontStyle: "italic" } satisfies CSSProperties,
} as const;
