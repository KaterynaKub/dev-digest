/**
 * Brief module constants. Every cap here is the brief's OWN — see helpers.ts's
 * doc comment on why `MAX_INTENT_FILES` and `MAX_CONTEXT_BLOCK_TOKENS` are not
 * reused even though today's values are equal: the two budgets are free to
 * diverge (0002a Requirements review).
 */
import type { FeatureModelChoice } from '@devdigest/shared';

/** NFR-5: at most this many changed files enter the brief's input file list. */
export const MAX_BRIEF_FILES = 300;
/** AC-15/NFR-6: at most this many selected documents per brief. */
export const MAX_BRIEF_DOCS = 5;
/**
 * AC-16/NFR-6: at most this many estimated tokens of document text per brief.
 * Lowered from the original 40_000 (NFR-24): documents alone can no longer be
 * five times the WHOLE input budget (`MAX_BRIEF_INPUT_TOKENS`, 8_000) — this
 * value must leave room for the changed-file list, derived intent, blast
 * radius, PR title/body, and linked issue sections that are assembled
 * alongside documents and are never dropped before them (priority order in
 * `helpers.ts#enforceInputBudget`).
 */
export const MAX_BRIEF_DOC_TOKENS = 4_000;
/**
 * NFR-24: the hard ceiling on the assembled brief input, measured in
 * TOKENIZER-COUNTED TOKENS (the injected `Tokenizer` port's `count(text)`,
 * `server/src/vendor/shared/adapters.ts`) of the assembled USER message only
 * — the section list joined with blank lines, EXCLUDING the system prompt.
 * When the assembled input exceeds this budget, whole sections are dropped
 * from the tail of the priority order (`helpers.ts#enforceInputBudget`) —
 * the request is never rejected; a brief is always generated. Every drop is
 * recorded in `BriefProvenance.dropped_sections`.
 */
export const MAX_BRIEF_INPUT_TOKENS = 8_000;
/** NFR-7: linked-issue text cap (chars). */
export const MAX_BRIEF_ISSUE_CHARS = 20_000;
/** NFR-7: PR body text cap (chars). */
export const MAX_BRIEF_BODY_CHARS = 20_000;
/** NFR-8: at most this many risks presented in one brief. */
export const MAX_BRIEF_RISKS = 10;
/** NFR-8: at most this many review-focus entries presented in one brief. */
export const MAX_BRIEF_FOCUS = 10;
/** NFR-3: document-selection deadline; on timeout, proceed with what ranked so far. */
export const DOC_SELECT_BUDGET_MS = 2_000;
/**
 * Why Timeline (0003): at most this many briefs retained per PR, pruned
 * oldest-by-`generated_at` on every `generate` — no time-based expiry. 10 is
 * undecidable from the repo (Requirements review); chosen as roughly the
 * number of force-pushes a PR sees before it merges. Changing this constant
 * is the ONLY step-4 edit a different retention depth requires.
 */
export const MAX_BRIEF_HISTORY = 10;

/**
 * Module default for brief generation — mirrors the `risk_brief` entry in
 * `contracts/platform.ts#FEATURE_MODELS`. `routes.ts` reads the workspace
 * override with `getFeatureModelOverride` (NOT `resolveFeatureModel`) so this
 * module-level default survives, same convention as `reviews/constants.ts`.
 */
export const DEFAULT_BRIEF_MODEL: FeatureModelChoice = {
  provider: 'openai',
  model: 'gpt-4.1',
};
