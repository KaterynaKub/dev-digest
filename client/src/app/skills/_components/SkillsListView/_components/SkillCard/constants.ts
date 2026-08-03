import type { IconName } from "@devdigest/ui";

/** Type→color mapping for the SkillCard type Badge and the leading icon.
    Same palette family as AgentCard's model chip — muted, no domain-specific
    color scale exists yet. */
export const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent-text)",
  convention: "var(--ok, #22c55e)",
  security: "var(--crit)",
  custom: "var(--text-muted)",
};

/** Source→icon mapping for the card's provenance line. A glyph per origin
    makes "where did this come from" scannable without reading the label. */
export const SOURCE_ICON: Record<string, IconName> = {
  manual: "Edit",
  extracted: "Sparkles",
  community: "Globe",
  imported_url: "Link",
};
