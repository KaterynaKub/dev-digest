/** Filter input debounce isn't needed (client-side filter over an already
    small list) — this file only holds the size knobs and the type palette
    shared between styles and the component. */
export const ROW_ICON_SIZE = 13;

/** Row height is fixed so a drag never reflows the list under the cursor. */
export const ROW_HEIGHT = 34;

/** Type→color for the trailing type badge. Same mapping as the Skills library
    card (skills/_components/SkillCard/constants.ts) — an agent's skill row and
    that skill's card must not disagree about what colour "security" is. */
export const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent-text)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-muted)",
};

export const TYPE_BG: Record<string, string> = {
  rubric: "var(--accent-bg)",
  convention: "var(--ok-bg)",
  security: "var(--crit-bg)",
  custom: "var(--bg-hover)",
};
