import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffSection. Longhand border properties wherever
 *  `is_large` changes the colour — mixing the `border` shorthand with a
 *  conditional `borderColor` silently loses one of them in React's style merging. */
export const s = {
  section: { marginBottom: 24 } satisfies CSSProperties,
  statsRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  stats: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  toggleWrap: {
    marginLeft: "auto",
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  toggleButton: (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),

  splitCallout: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "12px 14px",
    marginBottom: 12,
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,

  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 2px 6px",
    cursor: "pointer",
  } satisfies CSSProperties,
  groupChip: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  groupName: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupCaption: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupEmpty: { fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" } satisfies CSSProperties,

  fileCard: (isLarge: boolean): CSSProperties => ({
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: isLarge ? "var(--warn)" : "var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  }),
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingsDotWrap: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  findingsDot: (color: string): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 99,
    background: color,
  }),
  fileStat: { fontSize: 12, flexShrink: 0 } satisfies CSSProperties,

  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  // Copied from diff-viewer/styles.ts (deliberate — see SmartDiffSection.tsx
  // header comment) rather than imported, since they are plain objects and
  // copying keeps the shared module's surface unchanged.
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,

  markLineExtra: (color: string): CSSProperties => ({
    borderLeftStyle: "solid",
    borderLeftWidth: 2,
    borderLeftColor: color,
  }),

  // Button reset for the mark badge when it navigates (onGoToFinding
  // supplied) — longhand border, no new colour, inherits the Badge's own look.
  markButton: {
    background: "none",
    borderStyle: "none",
    padding: 0,
    cursor: "pointer",
    display: "inline-flex",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when open — same idiom as diff-viewer/styles.ts#chevronFor. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
