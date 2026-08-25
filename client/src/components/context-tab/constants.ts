/** Shared between styles and the component. Same knobs as the sibling
    `SkillsTab` (agent's skill-linking tab) — the two lists are visually one
    family. */
export const ROW_ICON_SIZE = 13;

/** Row height is fixed so a drag never reflows the list under the cursor. */
export const ROW_HEIGHT = 34;

/** Max attached documents (AC-12, mirrors server `MAX_DOCS_PER_ENTITY`).
    Inlined rather than imported — the server module's `constants.ts` is not
    part of `@devdigest/shared` and has no client-reachable path. */
export const MAX_ATTACHED_DOCS = 20;

/**
 * Type label + color per matched root, keyed by the FIRST PATH SEGMENT of
 * `ContextDoc.root` (e.g. `"specs/"` → `"specs"`) — AC-64/AC-65/AC-68. A root
 * outside this set (a custom root like `adr/`) falls back to the neutral
 * entry below rather than being hidden or miscolored.
 */
export const ROOT_TYPE_COLOR: Record<string, string> = {
  specs: "var(--accent-text)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export const ROOT_TYPE_BG: Record<string, string> = {
  specs: "var(--accent-bg)",
  docs: "var(--ok-bg)",
  insights: "var(--warn-bg)",
};

export const NEUTRAL_TYPE_COLOR = "var(--text-secondary)";
export const NEUTRAL_TYPE_BG = "var(--bg-hover)";

/** First path segment of a root string ("specs/" → "specs", "adr/sub/" →
    "adr"), used both as the row's type-badge label and as the palette key. */
export function rootTypeLabel(root: string | null): string | null {
  if (!root) return null;
  const seg = root.split("/").filter(Boolean)[0];
  return seg ?? null;
}
