import type { SkillType } from "@devdigest/shared";

/** Default type for a blank "create from scratch" skill. */
export const DEFAULT_SKILL_TYPE: SkillType = "custom";

/** `SkillType` values inlined (not imported as a runtime Zod value) — see
    client/INSIGHTS.md on avoiding pulling Zod into the client bundle. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Modal width (px) — matches CreateAgentModal. */
export const MODAL_WIDTH = 620;
