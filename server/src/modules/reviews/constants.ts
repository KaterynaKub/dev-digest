/**
 * Review module constants.
 */
import type { FeatureModelChoice } from '@devdigest/shared';

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

// ---- Intent classifier ----------------------------------------------------

/** PR body sent to the classifier is capped, matching MAX_PR_DESCRIPTION_CHARS in reviewer-core's prompt.ts. */
export const MAX_INTENT_BODY_CHARS = 4000;
/** Linked-issue body cap. */
export const MAX_INTENT_ISSUE_CHARS = 2000;
/** Spec/plan file cap. */
export const MAX_INTENT_SPEC_CHARS = 6000;
/** File-list rendering cap (one line per file); the remainder collapses to a tail note. */
export const MAX_INTENT_FILES = 200;
/** At most this many external links are ever considered per PR. */
export const MAX_INTENT_LINKS = 3;
/** External link body cap (chars), enforced by streaming — never by trusting headers. */
export const MAX_LINK_CHARS = 20_000;
/** Per-link fetch timeout. */
export const LINK_TIMEOUT_MS = 5_000;
/** Total time budget across all links fetched for one PR. */
export const LINK_TOTAL_BUDGET_MS = 10_000;
/** Max same-host redirect hops followed per link. */
export const LINK_MAX_REDIRECTS = 3;
/** Process-level link cache TTL. */
export const LINK_CACHE_TTL_MS = 3_600_000;
/** Content-Type values (compared before the `;`) accepted from a fetched link. */
export const ALLOWED_LINK_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'application/json',
] as const;

/** `.md` under specs/ or docs/, or *.spec.md anywhere — repo-relative paths only. */
export const SPEC_PATH_PATTERN = /^(?:specs|docs)\/[^\s"'()<>]+\.md$|^[^\s"'()<>]+\.spec\.md$/i;
/** Mirrors octokit.ts#resolveLinkedIssue's regex — "closes/fixes/resolves #123" or bare "#123". */
export const ISSUE_REF_PATTERN = /(?:closes|fixes|resolves)?\s*#(\d+)/gi;

/**
 * Module default for the intent classifier — a flash-class model, cheap
 * enough that deriving intent doesn't meaningfully add to review cost.
 * `routes.ts` reads the workspace override with `getFeatureModelOverride`
 * (NOT `resolveFeatureModel`) so this module-level default survives — see
 * `modules/settings/CLAUDE.md`.
 */
export const DEFAULT_INTENT_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};
