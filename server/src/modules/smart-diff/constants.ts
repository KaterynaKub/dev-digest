/**
 * 0005a — smart-diff module constants. Every literal used by classification,
 * sizing, and finding-selection lives here — `helpers.ts` and `service.ts`
 * carry none.
 *
 * This list intentionally DIFFERS from `repo-intel`'s `JUNK_PATH_PATTERNS`
 * (`modules/repo-intel/service.ts`): that list excludes tests and configs
 * because it samples files for the conventions extractor, where a test adds
 * no house-rule evidence. Here tests are hand-written intent and configs are
 * still worth a reviewer's eyes — see rule 13 and the `wiring` group. Do not
 * unify the two lists; they serve different jobs.
 */

/** Group render + priority order. All three are emitted even when empty. */
export const GROUP_ORDER = ['core', 'wiring', 'boilerplate'] as const;

/** Lower rank = more severe. Used to order findings and files within a group. */
export const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

// ---- Rule 1: lockfiles (exact basename match, never substring) ----
export const LOCKFILE_NAMES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
] as const;

// ---- Rule 2: generated directories (segment-bounded, also path-initial) ----
export const GENERATED_DIR_SEGMENTS = [
  '/dist/',
  '/build/',
  '/out/',
  '/.next/',
  '/coverage/',
  '/__snapshots__/',
  '/node_modules/',
  '/vendor/',
  '/target/',
  '/.turbo/',
] as const;

// ---- Rule 3: generated file patterns (tool-emitted; source lives elsewhere) ----
export const GENERATED_FILE_PATTERNS = [
  '*.generated.*',
  '*.gen.*',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  '*.pb.go',
  '*_pb2.py',
  '*.d.ts',
] as const;

// ---- Rule 4: migrations (Drizzle-generated from the schema, which is core) ----
export const MIGRATION_PATH_SEGMENTS = ['/migrations/', '/migration/', 'drizzle/meta/'] as const;

// ---- Rule 5: binary assets (no textual diff to review) ----
export const BINARY_ASSET_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
] as const;

/**
 * Extensions counted as genuine source for rule 6's size-based guess ONLY —
 * not a general whitelist. An unlisted extension still reaches rule 13 and
 * becomes `core`; this list only controls whether a very large diff falls
 * back to `boilerplate`.
 */
export const SOURCE_EXTS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.cs',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.sql',
  '.sh',
  '.md',
  '.yaml',
  '.yml',
  '.json',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.svelte',
] as const;

// ---- Rule 7: CI/automation plumbing ----
export const CI_PATH_SEGMENTS = [
  '.github/workflows/',
  '.gitlab-ci',
  '.circleci/',
  'azure-pipelines',
  'jenkinsfile',
  '.husky/',
] as const;

// ---- Rule 8: config files (declares how things assemble, not what they do) ----
export const CONFIG_FILE_PATTERNS = [
  '*.config.*',
  'package.json',
  'tsconfig*.json',
  '.eslintrc*',
  'eslint.config.*',
  '.prettierrc*',
  'dockerfile',
  'docker-compose*.y*ml',
  '.dependency-cruiser.cjs',
  'drizzle.config.ts',
] as const;

// ---- Rule 9: environment declarations ----
export const ENV_FILE_PATTERNS = [
  '.env*',
  '*.env',
  '.npmrc',
  '.nvmrc',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
] as const;

// ---- Rule 10: barrels (re-exports only, guarded by size) ----
export const BARREL_BASENAMES = ['index.ts', 'index.js', 'index.tsx', 'index.jsx', 'mod.rs', '__init__.py'] as const;

/** Above this churn, a barrel-named file is a real module, not a re-export list. */
export const MAX_BARREL_LINES = 40;

// ---- Rule 11: wiring basenames (per the brief) ----
export const WIRING_BASENAMES = [
  'routes.ts',
  'router.ts',
  'routes.tsx',
  'container.ts',
  'di.ts',
  'app.module.ts',
  'wire.go',
] as const;

// ---- Rule 12: locale/copy files ----
export const LOCALE_PATH_SEGMENTS = ['/messages/', '/locales/', '/i18n/'] as const;

/**
 * `is_large` threshold. Strictly ABOVE the client's existing
 * `AUTO_EXPAND_MAX_LINES = 200` (client/src/components/diff-viewer/constants.ts),
 * so the two constants never contradict each other on one screen; strictly
 * BELOW `MIN_LINES_FOR_GENERATED_GUESS`.
 */
export const LARGE_FILE_LINES_THRESHOLD = 300;

/** Rule 6: churn at/above this, with an unrecognised extension, reads as a generated dump. */
export const MIN_LINES_FOR_GENERATED_GUESS = 500;

/** `too_big` line threshold — the practical ceiling for effective review. */
export const SPLIT_LINES_THRESHOLD = 400;
/** `too_big` file-count threshold, counted over core+wiring only. */
export const SPLIT_FILES_THRESHOLD = 15;
/** A proposed split group below this size folds into `SPLIT_REST_GROUP_NAME`. */
export const MIN_FILES_PER_SPLIT = 2;
/** Cap on the number of proposed split groups returned. */
export const MAX_PROPOSED_SPLITS = 5;
/** Group name for root-level files (no top-level directory segment). */
export const SPLIT_ROOT_GROUP_NAME = '(root)';
/** Group name folding undersized groups together, only when 2+ of them exist. */
export const SPLIT_REST_GROUP_NAME = '(rest)';

/**
 * Batch window for `selectCycleFindings`: reviews from the same agent-run
 * batch land within this many ms of the newest review's `created_at`. Wide
 * enough for a normal multi-agent batch; a batch running longer loses its
 * slowest agent's marks (see spec's Open questions).
 */
export const FINDING_CYCLE_WINDOW_MS = 10 * 60 * 1000;

/** Defensive cap on `finding_marks` per file — `finding_count` stays uncapped. */
export const MAX_FINDING_MARKS_PER_FILE = 50;
