import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

/** `SkillType` values inlined here rather than imported as a runtime value —
    importing `SkillType` (the Zod enum) from `@devdigest/shared` would pull
    ~14kB of Zod into the client bundle for four strings (see client/INSIGHTS.md). */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export interface SkillTabDef {
  key: string;
  labelKey: string;
  icon?: IconName;
}

/** Detail-pane tabs. `evals` and `stats` are rendered but unimplemented —
    they show a Coming soon state rather than being hidden, so the surface
    reflects the intended shape of the Skills Lab. */
export const SKILL_TABS: readonly SkillTabDef[] = [
  { key: "config", labelKey: "detail.tabs.config" },
  { key: "preview", labelKey: "detail.tabs.preview" },
  { key: "evals", labelKey: "detail.tabs.evals" },
  { key: "stats", labelKey: "detail.tabs.stats" },
  { key: "versions", labelKey: "detail.tabs.versions" },
];

/** Rough token estimate for the body header chip. Deliberately local and
    approximate — the client has no tokenizer, and the server does not return
    a count. ~4 chars/token is the usual English-prose heuristic. */
export function estimateTokens(body: string): number {
  return Math.max(0, Math.ceil(body.trim().length / 4));
}
