import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  /** INTENT + BLAST RADIUS side by side (spec 0007-blast-radius.md §6.1). Each
   *  card manages its own vertical spacing, so this grid only owns the gap.
   *  `1fr 1fr` alone does NOT guarantee equal columns: a grid item defaults to
   *  `min-width: auto`, so it cannot shrink below its longest unbreakable
   *  content (a file path, an endpoint badge, a long symbol name), and that
   *  content pushes its column past 50% (spec §6.7). `gridItem` on each direct
   *  child resets that floor; the cards themselves must let their own long
   *  content wrap/truncate (BlastRadiusCard/styles.ts) or this floor reset
   *  just trades "column too wide" for "content overflows the column". */
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
    alignItems: "start",
  } satisfies CSSProperties,
  /** Wraps each direct grid child — do NOT change `gridTemplateColumns`
   *  itself to fix overflow; that reintroduces the customer-rejected
   *  auto-sizing behaviour. */
  gridItem: {
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
