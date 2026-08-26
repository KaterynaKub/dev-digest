# 0002a — PR Why + Risk Brief: server (contract, persistence, generation)

**Status:** done
**Date:** 2026-08-25
**Mode:** single-agent
**Touches:** `server/src/vendor/shared/contracts/brief.ts` · `client/src/vendor/shared/contracts/brief.ts` · `server/src/vendor/shared/contracts/review-api.ts` (+ client copy) · `server/src/modules/brief/` (new) · `server/src/db/schema/reviews.ts` · `server/src/db/migrations/` · `server/src/prompts/brief.system.md` (new) · `server/src/platform/container.ts` · `server/src/modules/index.ts`

## Requirements

Source: `docs/specs/SPEC-02-pr-why-risk-brief.md` (**Status: approved**).
This part implements the server half: AC-1…AC-7, AC-11…AC-18, AC-20…AC-23,
AC-25…AC-31, AC-33, AC-35…AC-41, AC-54…AC-56, AC-58…AC-61, NFR-2…NFR-7,
NFR-9…NFR-16, NFR-20…NFR-23.
Client card, navigation, and display criteria (AC-8…AC-10, AC-19, AC-24,
AC-32, AC-34, AC-42…AC-53, NFR-17…NFR-19) are `0002b`.

## Requirements review

- **The spec's "Module interactions" understates one hard boundary** — `[proceeding as asked]`
  It says brief consumes the blast radius "through that module's own service" and
  Project Context's discovery. Both are `service.ts` files in *other* modules, and
  `no-cross-module-service` (`server/.dependency-cruiser.cjs:126`) is **severity
  `error`**, not warn — a direct import takes `arch:check` from 0 errors to 2. The
  precedent that satisfies the requirement without the violation already exists:
  `mcp-tools/service.ts:135` declares a structural `BlastReader` port and
  `mcp-server.ts:42-53` constructs `BlastService` in the composition root and
  injects it. Applied to both dependencies in Step 5; behaviour is as asked.
- **AC-3's hunk headers are not in `pr_files`** — `[proceeding as asked]`
  That table holds `path`, `additions`, `deletions`, `patch` — no parsed hunks.
  `reviews/diff-loader.ts#loadDiff` yields a `UnifiedDiff` with `hunks[]`, and
  `reviews/intent-inputs.ts:98` already renders the exact AC-3 shape. Reuse both.
- **AC-55 is already satisfied by existing code** — `[recommended]`
  `reviewer-core/src/prompt.ts:45 wrapUntrusted` already does
  `replaceAll('</untrusted>', '<\\/untrusted>')`. AC-55 needs a test, not code.
- **`renderFileList`'s cap is 200, NFR-5 requires 300** — `[proceeding as asked]`
  `MAX_INTENT_FILES = 200` (`reviews/constants.ts:24`) belongs to intent — do not
  raise it; the brief gets its own constant and renderer. Likewise declare
  `MAX_BRIEF_DOC_TOKENS` locally rather than importing SPEC-01's equal-valued
  `MAX_CONTEXT_BLOCK_TOKENS` — the two budgets are free to diverge.
- **`pr_brief.json` cannot express AC-27** — `[proceeding as asked]`
  The spec names this. The cache key needs queryable `head_sha` and
  `indexed_sha`; Step 2 adds them as real columns.

## Problem

`pr_brief` (`db/schema/reviews.ts:83`) has existed since `0000_init.sql:211` and
is never read or written. `PrBrief` (`contracts/brief.ts:199`) is imported by
exactly one non-barrel line — `client/src/lib/types.ts:36`, a re-export with no
consumer. `risk_brief` sits in `FEATURE_MODELS` (`contracts/platform.ts:61`,
default `openai/gpt-4.1`) wired to nothing. Nothing composes `pr_intent`,
`BlastRadius`, `pr_files`, the linked issue, and the repository's markdown.

## Approach

A new module `server/src/modules/brief/` in the standard five-file shape.
`service.ts` orchestrates; ranking, rendering, and validation are pure code in
`helpers.ts`, unit-testable without a DB or a provider.

The two cross-module dependencies arrive as **structural ports** typed against
the shared contract, never as class imports — `BlastReader` (the shape
`mcp-tools` already declares) and a new `ContextDocReader`, both satisfied in the
composition root. Rejected: importing `BlastService` directly — bo
`no-cross-module-service` is an `error`; and re-implementing blast from
`RepoIntel` + `buildBlastRadius` — bo it duplicates the index-status mapping the
blast module exists to own.

`PrBrief` is redefined rather than extended — bo it has no consumer and the spec
requires the new shape. `PrHistory` stays exported and unused (decision 5).
The `pr_brief` row gains `head_sha`, `indexed_sha`, `generated_at`; `json` carries
the body plus its provenance. `pr_id` stays primary key, so regeneration
replaces (AC-31).

## Affected packages and modules

| Package | Path | What changes | Layer |
|---|---|---|---|
| server + client | `src/vendor/shared/contracts/brief.ts` | redefine `PrBrief`; add `ReviewFocusEntry`, `BriefProvenance` | 1 — Domain Model |
| server + client | `src/vendor/shared/contracts/review-api.ts` | add `PrBriefRecord`, `BriefGenerateRequest` | 1 |
| server | `src/modules/brief/{constants,helpers}.ts` (new) | caps; ranking, file rendering, reference validation | 2 — Domain Services |
| server | `src/modules/brief/service.ts` (new) | assembly, model call, cache | 4 — Application Services |
| server | `src/modules/brief/{repository,routes}.ts` (new) | `pr_brief` read/upsert; GET + POST, rate limit | 5 — Infrastructure |
| server | `src/db/schema/reviews.ts`, `src/db/migrations/` | `prBrief` gains 3 columns | 5 |
| server | `src/prompts/brief.system.md` (new) | system prompt | — |
| server | `src/platform/container.ts`, `src/modules/index.ts` | `briefRepo` + the two reader ports; register `brief` | Composition Root |

`@devdigest/shared` is vendored twice with no sync script and `server/` is
canonical. Both contract edits are **two-file edits**; verify with `diff`
(Verification plan) — a one-sided edit type-checks and silently desynchronises.

## Architectural constraints

- `brief/service.ts` must not import `BlastService`, `ProjectContextService`, or
  any other module's `service.ts`/`routes.ts` — `no-cross-module-service`,
  severity **error**. Consume them as structural interfaces declared in
  `brief/service.ts` and satisfied in `brief/routes.ts`.
- `brief/service.ts` must not import `Container`, `src/db/**`, `drizzle-orm`,
  `fastify`, or `src/adapters/**` with real I/O. Ports arrive in `BriefDeps`.
- `brief/helpers.ts` must import only `@devdigest/shared` types and
  `./constants.js` — `helpers-are-pure` matches the literal filename `helpers.ts`.
  Anything needing an adapter goes in a differently-named file.
- Cross-module **repository types, `helpers.ts`, and `constants.ts`** are allowed
  imports (`conventions/service.ts:18` imports `RepoRepository`) — so
  `reviews/diff-loader.ts` and `reviews/intent-inputs.ts` may be imported directly.
- `llm` is injected as a **resolver** `(provider) => Promise<LLMProvider>`, so a
  missing key fails one request, not startup (`server/CLAUDE.md`).
- `Tokenizer` is imported as a type from `@devdigest/shared` only; the concrete
  adapter resolves in the composition root — as `project-context/service.ts:34`.
- Every query is workspace-scoped: confirm the pull row via `workspace_id` before
  touching `pr_files` or `pr_brief`, which carry none (`blast/repository.ts:22`).
- NFR-16: log paths, sizes, counts — never issue, PR-body, or document text.

Enforced by: `cd server && pnpm arch:check` — read the summary line.

## Implementation steps

### Step 1 — Redefine the shared contract (both copies)
- **Files:** `server/src/vendor/shared/contracts/brief.ts`,
  `client/src/vendor/shared/contracts/brief.ts`
- **Do:** Replace `PrBrief` with `{ what: string, why: string, risk_level:
  RiskSeverity, risks: Risk[], review_focus: ReviewFocusEntry[] }`. `RiskSeverity`
  already exists (`high|medium|low`) and satisfies AC-5; `Risk` is reused as-is.
  Add `ReviewFocusEntry = { file: string, line: z.number().int().nullable(),
  reason: string }` — `nullable`, not `nullish`, so AC-25's "kept without a line"
  is an answered field. Add `BriefProvenance` carrying `head_sha`, `indexed_sha`
  (nullable), `index_stale`, `generated_at`, `missing_inputs: string[]`,
  `selected_docs: { path, rank }[]`, `dropped_docs: { path, limit:
  'count'|'tokens' }[]`, `rejected_entries: { entry, reason }[]`, `model`,
  `provider`, `tokens_in`/`tokens_out`/`cost_usd`/`cost_source` (all nullable),
  `retries`. Leave `PrHistory` exported and untouched.
  Write the server file, then copy it verbatim to the client.
- **Done when:** `diff` between the two paths is empty.

### Step 2 — Persistence
- **Files:** `server/src/db/schema/reviews.ts`, `server/src/db/migrations/` (new)
- **Do:** `prBrief` gains `headSha: text('head_sha').notNull()`,
  `indexedSha: text('indexed_sha')` (**nullable — AC-28's distinct key value**),
  `generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull()`.
  Generate the migration with `pnpm db:generate`; the table is empty in every
  environment, so `notNull` needs no backfill.
- **Done when:** `pnpm db:generate` emits one new `.sql` under `migrations/` and
  `pnpm db:migrate` applies it against a local DB.

### Step 3 — `constants.ts` and pure helpers
- **Files:** `server/src/modules/brief/constants.ts`, `.../helpers.ts` (both new)
- **Do:** Constants: `MAX_BRIEF_FILES = 300` (NFR-5), `MAX_BRIEF_DOCS = 5`
  (AC-15), `MAX_BRIEF_DOC_TOKENS = 40_000` (AC-16), `MAX_BRIEF_ISSUE_CHARS` and
  `MAX_BRIEF_BODY_CHARS` both `20_000` (NFR-7), `MAX_BRIEF_RISKS` and
  `MAX_BRIEF_FOCUS` both `10` (NFR-8), `DOC_SELECT_BUDGET_MS = 2_000` (NFR-3),
  `DEFAULT_BRIEF_MODEL = { provider: 'openai', model: 'gpt-4.1' }` mirroring the
  `risk_brief` entry at `contracts/platform.ts:61`.
  Helpers (all pure, no `await`):
  - `scoreDocument(docPath, changedPaths)` — count of repo-relative path segments
    shared with **any** changed path, extensions stripped, `0` when none (AC-60).
  - `rankDocuments(...)` — score desc, then path asc: a **total** order (AC-14),
    the tie-break NFR-11 rests on. Drops score-0 (AC-17).
  - `applyDocLimits(ranked, tokensOf)` — keeps the head, drops from the tail,
    returns `{ kept, dropped: { path, limit }[] }` (AC-15/16/18).
  - `renderBriefFileList(diff)` — `path (+A/-D) @@ … @@` per file, capped, tail
    line `… and N more files`. **No line content** (AC-3, NFR-4). Model on
    `reviews/intent-inputs.ts:98`.
  - `validateReferences(raw, { filePaths, endpoints, lineIndex })` — drops a whole
    risk or focus entry naming an unknown file or endpoint, recording
    `{ entry, reason }` (AC-20…AC-23); keeps an entry whose line is outside every
    hunk but sets `line: null` (AC-25). Caps **after** validation (NFR-8).
- **Done when:** `pnpm typecheck` from `server/` shows no new error.

### Step 4 — Repository
- **Files:** `server/src/modules/brief/repository.ts` (new)
- **Do:** `getPull(workspaceId, prId)` (workspace scope gate, copy
  `blast/repository.ts:22`), `getRepo(repoId)`, `getPrFilesWithPatch(prId)`,
  `getIntent(prId)`, `getBrief(prId)`, `upsertBrief(prId, body, provenance)`
  (`onConflictDoUpdate` on `pr_id` — replaces, per AC-31). Return domain-shaped
  objects, never Drizzle rows.
- **Done when:** no `service.ts` in this module imports `drizzle-orm` or `db/**`.

### Step 5 — Service: ports, assembly, generation, cache
- **Files:** `server/src/modules/brief/service.ts` (new)
- **Do:** Declare `BriefDeps`: `repo: BriefRepository`, `git: GitClient`,
  `tokenizer: Tokenizer`, `github: () => Promise<GitHubClient>`,
  `llm: (provider: Provider) => Promise<LLMProvider>`,
  `contextRoots: (workspaceId) => Promise<string[]>`,
  `reviewRepo: ReviewRepository` (for `loadDiff`), plus the two structural ports:
  ```ts
  /** Structural port over BlastService.forPull — never an import of that class
   *  (`no-cross-module-service`). Same pattern as mcp-tools' BlastReader. */
  export interface BlastReader { forPull(workspaceId: string, prId: string): Promise<BlastRadius>; }
  /** Structural port over ProjectContextService's discovery + read. */
  export interface ContextDocReader {
    listDocuments(workspaceId: string, repoId: string): Promise<{ docs: { path: string }[] }>;
    readDocument(workspaceId: string, repoId: string, path: string): Promise<{ content: string }>;
  }
  ```
  `getBrief(workspaceId, prId)` — read the row and compute `is_current` =
  `head_sha === pull.headSha && indexed_sha === blast.indexed_sha` (`===` on
  `null` handles AC-28's distinct value). Never a model call (AC-29, AC-30, NFR-1).
  `generate(workspaceId, prId, model)`:
  1. Workspace-scoped pull + repo. Guard AC-58 with a module-level `Set<string>`
     of in-flight `prId`s throwing `ConflictError`; `try/finally` so a throw
     always clears it.
  2. `loadDiff(...)`. **Zero files → the "changes nothing" state, no model call**
     (AC-39), mirroring `BlastService.forPull`'s early return.
  3. `Promise.allSettled` over intent, blast, linked issue — each rejection
     becomes a `missing_inputs` entry, never a throw (AC-35, AC-36, AC-38, NFR-9).
     `intent-inputs.ts#parseIssueRefs` → `github.getIssue` for the issue.
  4. Documents: `listDocuments` → `isContainedPath` on every path **before** any
     read (AC-56 — import from `project-context/helpers.js`, a helpers file, not a
     service) → `rankDocuments` → `applyDocLimits` with `tokenizer.count`, reading
     content only for the kept head — selection scores from **paths alone**
     (AC-61). Race the whole selection against `DOC_SELECT_BUDGET_MS`; on timeout
     proceed with what ranked and record it (NFR-3). A throw **and** a `''` return
     from `readFile` both mean missing (`server/INSIGHTS.md:143`).
  5. Prompt: `renderPrompt('brief.system.md', {})`; PR title/body, issue, and every
     document through `wrapUntrusted(label, text)` from `@devdigest/reviewer-core`
     (AC-54, AC-55, NFR-21), truncated to the `MAX_BRIEF_*_CHARS` caps first.
     Intent, blast, and the file list are DevDigest's own computations and are
     **not** re-wrapped — matching `run-executor.ts`.
  6. **Exactly one** `llm.completeStructured({ schema: PrBrief, schemaName:
     'PrBrief', maxRetries: 2 })` (AC-4). A throw after retries becomes
     `AppError('brief_generation_failed', …, 502)` **without writing the row**, so
     the stored brief survives (AC-40, AC-59, NFR-10).
  7. `validateReferences` against the assembled input (AC-20…AC-26). Persist the
     validated body only — never the raw response (NFR-22). Record `tokens_in`,
     `tokens_out`, `cost_usd`, `cost_source`, `retries` from `StructuredResult`
     (AC-7, NFR-15); **`cost_usd` of `0` is a real price** — carry it with `?? null`,
     never `|| null` (`server/INSIGHTS.md:39`).
  8. Persist against the head sha captured in sub-step 1, not re-read after the
     model call (AC-33).
- **Done when:** `arch:check` reports no new error and the file imports no other
  module's `service.ts`.

### Step 6 — Routes, prompt, wiring
- **Files:** `server/src/modules/brief/routes.ts`, `src/prompts/brief.system.md`
  (both new), `src/platform/container.ts`, `src/modules/index.ts`
- **Do:** `GET /pulls/:id/brief` → stored brief or `null`, no rate limit (a pure
  read, like `/pulls/:id/blast`). `POST /pulls/:id/brief/generate` with
  `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — the same limit the
  other money-spending PR route uses (`reviews/routes.ts:180`), satisfying NFR-23;
  model via `getFeatureModelOverride(container, workspaceId, 'risk_brief') ??
  DEFAULT_BRIEF_MODEL`; `reply.code(201)`.
  **Where the two ports are satisfied:** `no-cross-module-service`'s `from` is
  `^src/modules/([^/]+)/` with **no exemption for `routes.ts`**, so constructing
  `BlastService`/`ProjectContextService` there is likely a new error. Put both
  behind `platform/container.ts` getters (`container.blastReader`,
  `container.contextDocReader`) — the container is the sanctioned composition
  root — and have `routes.ts` read them. Confirm with `arch:check` either way.
  Add `briefRepo` to the container. Register `brief` in `modules/index.ts`.
  `brief.system.md`: the model receives **metadata only, never diff content**; it
  must reference only files and endpoints present in the input; `review_focus` is
  ordered most-important-first (AC-6).
- **Done when:** `GET /pulls/:id/brief` returns `null` for a PR with no brief.

### Step 7 — Tests
- **Files:** `server/src/modules/brief/*.test.ts`, `*.it.test.ts` (new)
- **Do:** Hermetic (`helpers.test.ts`): ranking with **two documents of equal
  score** so the AC-14 tie-break is actually exercised — bo a fixture of distinct
  scores passes against an unstable sort (NFR-11); both limits of AC-15/16 with
  their recorded `limit` label; `renderBriefFileList` asserting **no `+`/`-` line
  content** and the omitted-count tail (AC-3, NFR-4, NFR-5); `validateReferences`
  for an invented file, an invented endpoint, an out-of-hunk line kept without a
  line (AC-25), and the all-rejected case (AC-26); `wrapUntrusted` neutralising
  `</untrusted>` (AC-55); `isContainedPath` on absolute and `..` paths (AC-56);
  cache-key comparison with `indexed_sha: null` on one side (AC-28).
  Integration — **name it `brief.it.test.ts`; the filename is what puts it in the
  DB lane**: persistence and replacement on regenerate (AC-29…AC-31), the second
  concurrent request rejected (AC-58), a failed generation leaving the stored row
  intact (AC-59), the recorded document set and rejections (AC-18, AC-23),
  degradation with intent / blast / issue absent in turn (AC-35, AC-36, AC-38),
  head-sha-changed-mid-flight (AC-33). Stub the provider; for AC-7 assert a
  `costUsd` of **`0`** is stored as `0`, not `null`.
- **Done when:** hermetic count is 417 + new; integration passes, or is skipped
  where Docker is unavailable.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| after step 1 | `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` — and the same for `review-api.ts` | repo root | **no output** for both; neither package compiling counts as evidence |
| after step 2 | `pnpm db:migrate` | `server/` | exit 0 |
| after steps 3, 5, 6 | `pnpm typecheck` | `server/` | **exactly the 2 baseline errors** (`db/migrate.ts:38`, `db/seed.ts:499`); any third is yours |
| after steps 5, 6 | `pnpm arch:check` | `server/` | summary line `x N dependency violations (E errors, W warnings)` shows **0 errors** and **≤ 6 warnings**. Exit code is 0 regardless — never judge by it, never pipe to `head`/`tail` |
| after step 7 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | ≥ 417 passing, 0 failing |
| after step 7 | `pnpm exec vitest run .it.test` | `server/` | passing; needs Docker — skipped without it. **Run separately from the hermetic lane** — both at once fail under contention |
| after step 1 | `pnpm typecheck` | `client/` | no new error from the contract edit |

Baseline to record before the first edit: `pnpm typecheck` output from `server/`
(expect 2 errors), the `arch:check` summary line (expect 6 warnings / 0 errors),
and the hermetic test count (expect 417 in 36 files).

## Acceptance
- [ ] AC-1…AC-7, AC-11…AC-18, AC-20…AC-23, AC-25…AC-31, AC-33, AC-35…AC-41,
      AC-54…AC-56, AC-58…AC-61 hold, each with the test named in Step 7.
- [ ] NFR-3…NFR-7, NFR-9…NFR-16, NFR-20…NFR-23 hold. NFR-2 is **manual review
      only** — the spec records that no fixture of that scale exists.
- [ ] The two vendored contract copies are byte-identical by `diff`.
- [ ] `arch:check` reports 0 errors and no more than 6 warnings.
- [ ] No log line carries issue, PR-body, or document text.

## Out of scope
- Writing or amending any specification — `docs/specs/` and `<package>/specs/`.
- All client work (AC-8…AC-10, AC-19, AC-24, AC-32, AC-34, AC-42…AC-53,
  NFR-17…NFR-19) — `0002b`.
- Exposing the brief as an MCP tool (Resolved decision 3); deleting `PrHistory`
  (decision 5); invalidating a brief when a selected document changes on disk
  (decision 4 — accepted limitation).
- Embedding-based document selection; `code_chunks` stays unreferenced.
- Any change to `IntentCard`, `BlastRadiusCard`, the Files-changed tab, or a
  review run's `## Project context` block.

## Open questions

None — everything needed was determinable from the repo. The one plan-shaping
decision, consuming another module's service without breaking
`no-cross-module-service`, is settled by the `mcp-tools#BlastReader` precedent
(`server/src/modules/mcp-tools/service.ts:127-136`, `server/src/mcp-server.ts:42-53`).
