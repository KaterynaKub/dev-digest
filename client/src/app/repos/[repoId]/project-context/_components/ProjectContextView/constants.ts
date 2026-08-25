/** Same root→type palette as `ContextTab` (agent/skill attachment lists) —
    AC-64/65/68 apply to every surface that shows a document's matched root,
    not only the attachment lists. Duplicated rather than imported: the two
    components live under different route trees and cross-route imports of
    route-owned code are forbidden by this repo's lint config (see
    `components/context-tab/ContextTab.tsx`'s doc comment) — this constants
    file has no domain logic, just a literal palette, so a third copy costs
    less than lifting a whole shared module for four color pairs. */
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

export function rootTypeLabel(root: string | null): string | null {
  if (!root) return null;
  const seg = root.split("/").filter(Boolean)[0];
  return seg ?? null;
}
