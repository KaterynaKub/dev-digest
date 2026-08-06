import type { CSSProperties } from "react";

/** Co-located styles for SettingsIntentLinks. */
export const s = {
  wrap: { maxWidth: 640, marginTop: 28 } satisfies CSSProperties,
  addRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    marginBottom: 14,
  } satisfies CSSProperties,
  addInput: { flex: 1 } satisfies CSSProperties,
  entryList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  entryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  entryPattern: {
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  emptyState: {
    display: "flex",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 14,
  } satisfies CSSProperties,
  emptyStateIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  note: {
    display: "flex",
    gap: 10,
    marginTop: 8,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  invalidHint: {
    fontSize: 12,
    color: "var(--crit)",
    marginTop: 6,
  } satisfies CSSProperties,
  saveRow: {
    display: "flex",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
} as const;
