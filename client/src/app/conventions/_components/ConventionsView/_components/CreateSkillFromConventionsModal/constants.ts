import type { SkillType } from "@devdigest/shared";

export const MODAL_WIDTH = 720;

/** Local list rather than the `SkillType` Zod enum: importing the enum as a
 *  RUNTIME value drags ~14 kB of Zod into the client bundle (see the same note
 *  in SkillDetail/constants.ts). */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** Rough token estimate for the body header chip. Deliberately local and
 *  approximate — the client has no tokenizer and the server returns no count.
 *  ~4 chars/token is the usual English-prose heuristic. */
export function estimateTokens(body: string): number {
  return Math.max(0, Math.ceil(body.trim().length / 4));
}
