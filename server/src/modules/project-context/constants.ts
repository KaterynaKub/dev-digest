/** Constants for the project-context module. */

export { EXCLUDED_DIRS } from '../repo-intel/constants.js';

/**
 * Default context roots (AC-44). Mirrored (not imported) in
 * `modules/settings/feature-models.ts`, whose `readContextRoots` must be able
 * to fail open to a value before this module exists to define one — see that
 * file's doc comment for why the duplication is deliberate.
 */
export const DEFAULT_CONTEXT_ROOTS = ['specs/', 'docs/', 'insights/'];

/** Max attached documents per agent or per skill (AC-12, NFR-3). */
export const MAX_DOCS_PER_ENTITY = 20;

/** Max documents returned by discovery, by walk order (NFR-5). */
export const MAX_LISTED_DOCS = 1000;

/** Max characters injected from any one document at run time (AC-33). */
export const MAX_DOC_CHARS = 150_000;

/** Max estimated tokens for the assembled `## Project context` block (AC-34). */
export const MAX_CONTEXT_BLOCK_TOKENS = 40_000;

/** Deadline for the summed token estimate before the listing degrades to
 *  `pending: true` rather than blocking (AC-61, NFR-20/21). */
export const SUM_ESTIMATE_BUDGET_MS = 3_000;

/** Byte bound backing NFR-20's 500 docs / 20 MB scale target (NFR-22). */
export const SUM_ESTIMATE_MAX_BYTES = 20 * 1024 * 1024;

/** Extension the discovery walk matches (AC-1: `**\/*.md`). */
export const CONTEXT_DOC_EXT = '.md';
