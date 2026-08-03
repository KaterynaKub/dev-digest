import type { SkillType } from "@devdigest/shared";

/** Same inlined SkillType list as SkillsListView/constants.ts — kept local so
    this component doesn't reach across into a sibling's constants module. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Accepted file extensions for the native file input — markdown or a zip
    archive (see server/src/modules/skills/CLAUDE.md for the archive rules). */
export const ACCEPTED_EXTENSIONS = ".md,.markdown,.zip";
