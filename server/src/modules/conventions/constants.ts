/**
 * Sampling, budget and model constants for the conventions extractor.
 *
 * Sample selection is entirely CODE-DRIVEN — no model call decides which files
 * are read. See the module CLAUDE.md for why.
 */

/** Top-N ranked source files sampled per scan. */
export const SAMPLE_FILE_COUNT = 12;

/**
 * Config files probed by exact path, in priority order.
 *
 * These CANNOT come from repo-intel: `walkClone` only indexes `SUPPORTED_EXT`
 * (.ts/.tsx/.js/.jsx/.mjs/.cjs), so `package.json`/`tsconfig.json`/`.eslintrc`
 * are never in the index at all — and `getConventionSamples` additionally
 * filters `eslint`/`prettier`/`.config.` out via `JUNK_PATH_PATTERNS`. A fixed
 * probe list is the simplest mechanism that cannot regress when that junk
 * filter changes. Missing files are skipped silently.
 */
export const CONFIG_PROBE_PATHS = [
  'package.json',
  'tsconfig.json',
  '.eslintrc.json',
  '.eslintrc.cjs',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  '.editorconfig',
] as const;

/** Per-file char cap. Keeps the HEAD: imports and first declarations are
 *  where conventions are visible. */
export const MAX_FILE_CHARS = 6_000;

/** Per-config-file cap — package.json can be enormous. */
export const MAX_CONFIG_CHARS = 3_000;

/** Whole-prompt cap for the assembled sample block. */
export const MAX_TOTAL_CHARS = 60_000;

/**
 * Cheap default when the workspace has not overridden the choice. Mirrors the
 * `conventions` entry in the shared `FEATURE_MODELS` registry — resolved via
 * `getFeatureModelOverride` (NOT `resolveFeatureModel`) so this module keeps
 * its own dynamic default, exactly as that helper's doc comment prescribes.
 */
export const DEFAULT_CONVENTIONS_MODEL = {
  provider: 'openrouter' as const,
  model: 'deepseek/deepseek-v4-flash',
};

/** Hard cap on persisted candidates per scan. */
export const MAX_CANDIDATES = 20;

/** Candidates below this are dropped before persistence. */
export const MIN_CONFIDENCE = 0.5;

/** An evidence range wider than this is the model pointing at a whole file
 *  rather than at evidence. */
export const MAX_EVIDENCE_LINES = 60;

/** A rule shorter than this carries no information. */
export const MIN_RULE_LENGTH = 10;
