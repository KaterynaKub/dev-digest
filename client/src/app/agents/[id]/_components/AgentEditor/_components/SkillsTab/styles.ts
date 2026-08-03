import type { CSSProperties } from "react";
import { ROW_HEIGHT } from "./constants";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 185,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.5 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  /* `linked` drives the whole row treatment: an attached skill sits on an
     elevated surface with a visible border, an unattached one recedes. The
     drop indicator is a border-top so it never changes the row's height and
     the list can't jitter mid-drag. */
  row: (linked: boolean, dragging: boolean, dropBefore: boolean): CSSProperties => {
    // Longhand only: mixing `border` with `borderTop` makes React warn about
    // conflicting shorthand/longhand updates when the drop indicator toggles.
    const edge = linked ? "var(--border)" : "transparent";
    return {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: ROW_HEIGHT,
      padding: "0 10px 0 8px",
      borderRadius: 7,
      borderStyle: "solid",
      borderColor: dropBefore ? `var(--accent) ${edge} ${edge}` : edge,
      borderWidth: dropBefore ? "2px 1px 1px" : 1,
      background: linked ? "var(--bg-elevated)" : "var(--bg-surface)",
      opacity: dragging ? 0.4 : 1,
      transition: "background .12s, border-color .12s",
    };
  },
  handle: {
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    flexShrink: 0,
    color: "var(--text-muted)",
    cursor: "grab",
  } satisfies CSSProperties,
  checkbox: (checked: boolean): CSSProperties => ({
    width: 15,
    height: 15,
    flexShrink: 0,
    borderRadius: 3,
    border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
    background: checked ? "var(--accent)" : "transparent",
    display: "grid",
    placeItems: "center",
    padding: 0,
    cursor: "pointer",
  }),
  rowName: (linked: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: 500,
    color: linked ? "var(--text-primary)" : "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }),
  /* The reorder buttons are the keyboard/no-pointer path for what the drag
     handle does with a mouse, so they're revealed on hover (and kept in the
     tab order regardless). Absolute, because inserting them into the flow on
     hover would shove the type badge sideways under the cursor. */
  reorderOverlay: (visible: boolean): CSSProperties => ({
    position: "absolute",
    right: 88,
    display: "flex",
    alignItems: "center",
    gap: 2,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? "auto" : "none",
    transition: "opacity .12s",
  }),
  reorderBtn: (disabled: boolean): CSSProperties => ({
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    padding: 0,
    border: "none",
    background: "none",
    color: "var(--text-muted)",
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  /* Fixed width so every badge shares one right-hand column — otherwise a
     long type ("convention") pushes its row's edge past the others. */
  typeBadge: {
    width: 78,
    flexShrink: 0,
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,

  disabledWarning: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--warn)",
    marginTop: 12,
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "10px 4px" } satisfies CSSProperties,
  savingNote: { fontSize: 12, color: "var(--text-muted)", marginTop: 12, height: 16 } satisfies CSSProperties,
} as const;
