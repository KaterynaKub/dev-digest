import type { CSSProperties } from "react";

/** Co-located styles for SkillDetail and its tab panels. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", minWidth: 0 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 24px 0",
  } satisfies CSSProperties,
  titleIcon: { color: "var(--accent-text)", flexShrink: 0 } satisfies CSSProperties,
  name: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  headerSpacer: { flex: 1 } satisfies CSSProperties,
  tabsBar: { marginTop: 12 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: "22px 24px 32px" } satisfies CSSProperties,

  /* --- Config tab --- */
  sectionHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginLeft: "auto",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /* Body editor gets a file-strip header (filename · unsaved · token count)
     so the textarea reads as an editor pane, not a bare form control. */
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
  tokens: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 20 } satisfies CSSProperties,
  savedNote: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  /* --- Preview tab --- */
  previewHead: { marginBottom: 16 } satisfies CSSProperties,
  previewTitle: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  previewSub: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,
  previewCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "20px 24px",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" } satisfies CSSProperties,
  notice: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 14,
  } satisfies CSSProperties,

  /* --- Versions tab --- */
  versionsHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  versionsSub: { fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 18, lineHeight: 1.5 } satisfies CSSProperties,
  versionList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  versionRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  versionChip: { flexShrink: 0 } satisfies CSSProperties,
  versionMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  versionLabel: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  versionDate: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  versionActions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,

  /* --- Empty / coming-soon --- */
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 6,
    padding: 32,
  } satisfies CSSProperties,
  emptyTitle: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  emptyBody: { fontSize: 13, color: "var(--text-secondary)", maxWidth: 320, lineHeight: 1.5 } satisfies CSSProperties,
} as const;
