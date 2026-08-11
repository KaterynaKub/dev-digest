# 0005a — Smart Diff · Part A (server)

**Status:** done
**Date:** 2026-08-06
**Touches:** src/modules/smart-diff (new) · src/modules/index.ts · src/platform/container.ts · src/vendor/shared/contracts/brief.ts · ../client/src/vendor/shared/contracts/brief.ts

Part A of three: **0005a** contract + server module · **0005b** client component ·
**0005c** navigation to the finding card + doc sweep. Each is self-contained.

---

## Prerequisites

None — this is the first part. Verify the starting state:

```
cd server && diff src/vendor/shared/contracts/brief.ts ../client/src/vendor/shared/contracts/brief.ts
```

Must print **nothing**. If it prints a diff, stop — someone already edited one
side and Step 1 will make it worse.

---

## Summary

"Files changed" lists a PR's files in GitHub's order, so the reviewer meets
`pnpm-lock.yaml` before the service method that actually changed. This feature
classifies every changed file as `core` / `wiring` / `boilerplate`, sorts within
each group by review priority, and serves it from a new endpoint.

Part A builds the producer only. At the end, `GET /pulls/:id/smart-diff` returns
a valid `SmartDiff` and no client consumes it yet — expected and correct.

**No LLM call anywhere in this feature** — not an optimisation but the defining
constraint. Classification is path patterns plus integer arithmetic, all pure
functions in `helpers.ts`. Verified structurally in Acceptance.

The contract already exists and is **completely dead**: `SmartDiff` and friends
sit in `contracts/brief.ts:112-145`, `SmartDiffResponse` aliases it in
`contracts/review-api.ts:75-77`, `client/src/lib/types.ts:36` re-exports the
type, `client/messages/en/prReview.json:81-90` carries an unused `smartDiff`
block — and a repo-wide grep finds **zero** consumers. This part wires it up.

Scope: one server module (five files, no DB writes), one contract extension in
two vendored copies, three test files.

---

## Baseline (judge every check by delta, never by exit code)

- `server` typecheck: **2 pre-existing errors** — `db/migrate.ts:38`,
  `db/seed.ts:499` (both `TS2345`). "It failed" is not a signal; "it produced a
  third error" is.
- `server` `arch:check`: **6 warnings, 0 errors**. It **exits 0 even with
  violations** — judge by the summary line `x N dependency violations (E errors,
  W warnings)`.
- `server` tests: 209 hermetic in 23 files.
- Never pipe a check into `tail`/`head` — `$?` becomes `tail`'s status and a
  failure reads as success. Redirect to a file, capture the status, then read it.
- No `lint` script in `server/`. DB tests **must** be named `*.it.test.ts` —
  anything else lands in the hermetic suite and fails without a database.

---

## Architectural constraints

1. `helpers.ts` is **pure**: no `await`, no `this`, no I/O, no `Date.now()`, no
   imports beyond `@devdigest/shared` types and `./constants.js`. `helpers-are-pure`
   is `warn` today only because `repos/helpers.ts` already breaches it — do not
   add the second violation.
2. `constants.ts` holds **every** literal — patterns, thresholds, caps, severity
   rank. No magic number in `helpers.ts` or `service.ts`.
3. `service.ts` takes an explicit `SmartDiffDeps` built in `routes.ts`, never the
   `Container` (`service-no-container`, **error**); no `db/**`, `drizzle-orm`,
   `postgres` (`service-no-sql`, **error**); no `fastify` (`service-no-http`,
   **error**). Throws `NotFoundError` from `platform/errors.js`.
4. `routes.ts` owns the zod param schema and status codes, and reads the
   repository **off the container**. `routes-no-persistence` is `warn` (breached
   by `pulls`/`settings` already) — do not grow that count. Its `to.path` also
   forbids `^src/modules/[^/]+/repository`, and `tsPreCompilationDeps: true`
   means type-only imports **are** seen — if a type import trips it, take the
   type from `service.ts`'s re-export. Verify against the summary line.
5. **No LLM, anywhere.** None of the five files may import `LLMProvider`,
   `Provider`, `FeatureModelChoice`, `resolveFeatureModel`,
   `getFeatureModelOverride`, `renderPrompt`, `wrapUntrusted`, or anything under
   `src/adapters/llm/`. `SmartDiffDeps` has exactly one member (`repo`).
6. No cross-module **service** import (`no-cross-module-service`, **error**) —
   this module gets its own repository rather than calling `ReviewService`.
7. **Nothing is written.** `select` only; `pnpm db:generate` must produce no new
   file — bo the whole feature computes on read.
8. `@devdigest/shared` is vendored **twice** with no sync script. Step 1 is a
   **two-file edit**; a one-sided edit type-checks in its own package and
   silently desynchronises the API. `server/` is canonical.

---

## Classification algorithm

**First-match-wins ordered scan.** `classifyPath` walks rules top to bottom and
returns on the first hit — that order is the contract, and it is what makes the
result explainable ("boilerplate *because* it matched `pnpm-lock.yaml`"). All
matching on the lowercased, forward-slashed path; every pattern a constant.

| # | Constant → match | Role | Why |
|---|---|---|---|
| 1 | `LOCKFILE_NAMES` (exact basename): `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, `cargo.lock`, `poetry.lock`, `gemfile.lock`, `composer.lock`, `go.sum` | boilerplate | Machine-written. Exact basename, never substring — `mylock.json` is not a lockfile |
| 2 | `GENERATED_DIR_SEGMENTS` (segment): `/dist/`, `/build/`, `/out/`, `/.next/`, `/coverage/`, `/__snapshots__/`, `/node_modules/`, `/vendor/`, `/target/`, `/.turbo/`, also path-initial | boilerplate | Build output. **Segment-bounded** so `distribution/` and `myvendor/` do not match |
| 3 | `GENERATED_FILE_PATTERNS`: `*.generated.*`, `*.gen.*`, `*.min.js`, `*.min.css`, `*.map`, `*.snap`, `*.pb.go`, `*_pb2.py`, `*.d.ts` | boilerplate | Tool-emitted; the source is elsewhere in the PR |
| 4 | `MIGRATION_PATH_SEGMENTS`: `/migrations/`, `/migration/`, `drizzle/meta/` | boilerplate | Drizzle generates these from the schema, and the schema lands in `core`. **The most arguable rule** — a hand-written migration would be misfiled; dropping it is one line |
| 5 | `BINARY_ASSET_EXTS`: `.png .jpg .jpeg .gif .svg .ico .webp .woff .woff2 .ttf .eot .pdf .zip` | boilerplate | No textual diff to review |
| 6 | `additions + deletions >= MIN_LINES_FOR_GENERATED_GUESS` **and** extension not in `SOURCE_EXTS` | boilerplate | Catch-all for a dump that dodged 1–5. **The only size-based classification rule** |
| 7 | `CI_PATH_SEGMENTS`: `.github/workflows/`, `.gitlab-ci`, `.circleci/`, `azure-pipelines`, `jenkinsfile`, `.husky/` | wiring | Automation plumbing |
| 8 | `CONFIG_FILE_PATTERNS`: `*.config.*`, plus exact `package.json`, `tsconfig*.json`, `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `dockerfile`, `docker-compose*.y*ml`, `.dependency-cruiser.cjs`, `drizzle.config.ts` | wiring | Declares how things assemble, not what they do |
| 9 | `ENV_FILE_PATTERNS`: `.env*`, `*.env`, exact `.npmrc`, `.nvmrc`, `.gitignore`, `.dockerignore`, `.editorconfig` | wiring | Environment declarations |
| 10 | `BARREL_BASENAMES`: `index.{ts,js,tsx,jsx}`, `mod.rs`, `__init__.py` **and** churn `<= MAX_BARREL_LINES` | wiring | A barrel is re-exports. The size guard matters — a 300-line `index.ts` is a real module, not a barrel |
| 11 | `WIRING_BASENAMES`: `routes.ts`, `router.ts`, `routes.tsx`, `container.ts`, `di.ts`, `app.module.ts`, `wire.go` | wiring | Per the brief. **Tension:** here `routes.ts` owns zod schemas and status codes — real decisions. Compensated by the finding-first sort inside the group |
| 12 | `LOCALE_PATH_SEGMENTS`: `/messages/`, `/locales/`, `/i18n/` with `.json` | wiring | Copy, not logic |
| 13 | **default** | core | Everything else, **including tests** |

**Tests are `core`** — bo a test is hand-written intent, and a weakened test is
exactly the defect class a "skim" group would conceal. `__snapshots__/` is the
exception and rule 2 catches it. This list deliberately differs from
`repo-intel`'s `JUNK_PATH_PATTERNS` (which excludes tests and configs, for a
different job — sampling for the conventions extractor); say so in a comment in
`constants.ts` so nobody unifies them.

**Unknown extensions reach rule 13 and become `core`** — bo showing a reviewer
something skippable costs far less than hiding something they needed. Rule 6 is
the one exception, and only when the file is also very large.

### Sorting within a group

Must be a **total** order — a stable sort is not enough, bo ties would then
depend on the order `pr_files` came back in, and Postgres promises none without
`ORDER BY`. Comparators: (1) has findings, (2) worst severity by
`SEVERITY_RANK`, (3) finding count desc, (4) churn desc, (5) **path asc**. The
last one is what makes the endpoint deterministic — never omit it.

Group order is always `core, wiring, boilerplate` from `GROUP_ORDER`, and **all
three are emitted even when empty** — bo the client renders three stable
sections.

### `split_suggestion`

- `total_lines` = churn over **every** file including boilerplate — bo a
  reviewer reading "285 changed lines" expects GitHub's number.
- `too_big` when `reviewableLines >= SPLIT_LINES_THRESHOLD` **or**
  `reviewableFiles >= SPLIT_FILES_THRESHOLD`, counting **core + wiring only** —
  bo a lockfile bump can add thousands of lines without making the PR harder to
  review, and firing on every dependency update trains people to ignore it.
- `proposed_splits` only when `too_big`; group core+wiring by **top-level path
  segment** (root files under `(root)`), drop groups below `MIN_FILES_PER_SPLIT`,
  fold leftovers into `(rest)` only if two or more, sort by count desc then name
  asc, cap at `MAX_PROPOSED_SPLITS`. Top-level directory is the one grouping both
  computable without a model and meaningful to a human. Grouping by *role* was
  rejected — "split your boilerplate into its own PR" is not actionable, bo the
  boilerplate is generated by the core change.

### Which findings mark the diff

A PR has many reviews (one per agent, several cycles). All-time findings would
mark line numbers from an older commit; only-the-newest would drop the other
agents in the same batch. **Rule:** take the newest review's `created_at`, keep
the newest review per `agent_id` within `FINDING_CYCLE_WINDOW_MS` of it, dedupe
by `(file, start_line, severity)`. Computed in `helpers.ts` from rows the
repository hands over, so it is unit-testable without a DB.

Deliberately **not** matched on `head_sha` — `reviews` has no such column (only
`agent_runs` does), and reaching into the run lifecycle for a cosmetic gain
would couple this module to it.

---

## Implementation steps

### Step 0 — Record the baseline

Capture `pnpm arch:check` (summary line), `pnpm typecheck` (the 2 errors), and
`pnpm test` (209 in 23 files) before the first edit.

### Step 1 — Extend `SmartDiffFile` (both vendored copies, all fields at once)

**Files:** `server/src/vendor/shared/contracts/brief.ts`,
`client/src/vendor/shared/contracts/brief.ts` — **identical edits**.

Add `import { Severity } from './findings.js';` — allowed by `contracts-are-pure`
(sibling contracts are explicitly permitted) and `review-api.ts:2-3` already does
it. Use the `.js` specifier: the server is ESM and the client resolves it via
`extensionAlias`.

```ts
/** One flagged line, carrying what flagged it and how to navigate to it. */
export const SmartDiffFindingMark = z.object({
  line: z.number().int(),
  severity: Severity,
  finding_id: z.string(),
  review_id: z.string(),
});
export type SmartDiffFindingMark = z.infer<typeof SmartDiffFindingMark>;
```

Then extend `SmartDiffFile` — leaving `path`, `pseudocode_summary`, `additions`,
`deletions`, `finding_lines` untouched:

```ts
finding_marks: z.array(SmartDiffFindingMark).nullish(),
finding_count: z.number().int().nonnegative().nullish(),
is_large: z.boolean().nullish(),
```

**All three are `.nullish()`, not required** — bo `test/contracts.test.ts:107-118`
parses a fixture without them, and required fields would force an edit to the one
assertion that exists to pin this contract. It also matches the sibling
`pseudocode_summary: z.string().nullish()`. **The fixture is NOT edited.** The
producer always sets all three, so optionality is a compatibility affordance, not
a licence to omit.

`finding_id` + `review_id` exist for part C's navigation. `run_id` is
deliberately **not** on the wire — `reviews.run_id` is nullable
(`review-api.ts:27`) and the client already holds an authoritative mapping.

Do **not** touch `Severity`, `SmartDiffRole`, `SmartDiffGroup`, `ProposedSplit`,
`SmartDiff`, or `PrBrief` — Smart Diff is deliberately a sibling of the brief,
not a member of it.

**Done when:** server typecheck shows the same 2 errors; `cd client && pnpm
typecheck` exits 0; the `diff` of the two copies prints **nothing**.

### Step 2 — `constants.ts`

**File:** `server/src/modules/smart-diff/constants.ts` (new). Literals only, one
doc comment per export saying *why*. Mirror `modules/repos/constants.ts`'s style.

- `GROUP_ORDER = ['core','wiring','boilerplate']`
- `SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 }`
- All twelve pattern lists from the table above, plus `SOURCE_EXTS`
  (`.ts .tsx .js .jsx .mjs .cjs .py .go .rs .java .kt .rb .php .cs .swift .c .h
  .cpp .hpp .sql .sh .md .yaml .yml .json .css .scss .html .vue .svelte`), used
  **only** by rule 6 — it is not a whitelist for anything else.
- `MAX_BARREL_LINES = 40`
- `LARGE_FILE_LINES_THRESHOLD = 300` — strictly above the client's existing
  `AUTO_EXPAND_MAX_LINES = 200` (`client/src/components/diff-viewer/constants.ts:4`),
  bo otherwise two constants would contradict each other on one screen; strictly
  below `MIN_LINES_FOR_GENERATED_GUESS`.
- `MIN_LINES_FOR_GENERATED_GUESS = 500`
- `SPLIT_LINES_THRESHOLD = 400` (the practical ceiling for effective review),
  `SPLIT_FILES_THRESHOLD = 15`, `MIN_FILES_PER_SPLIT = 2`,
  `MAX_PROPOSED_SPLITS = 5`, `SPLIT_ROOT_GROUP_NAME = '(root)'`,
  `SPLIT_REST_GROUP_NAME = '(rest)'`
- `FINDING_CYCLE_WINDOW_MS = 10 * 60 * 1000`
- `MAX_FINDING_MARKS_PER_FILE = 50` — defensive cap; `finding_count` still
  reports the true total.
- Header comment: this list **intentionally differs** from `repo-intel`'s
  `JUNK_PATH_PATTERNS`.

### Step 3 — `helpers.ts`

**File:** `server/src/modules/smart-diff/helpers.ts` (new). Every export pure.

- `normalisePath` — lowercase, backslashes → slashes. `classifyPath` calls it
  itself, bo classification must never depend on the caller remembering to.
- `classifyPath(path, additions, deletions)` — the 13-rule scan. Only rules 6 and
  10 read the sizes.
- `isLargeFile(additions, deletions)` — churn vs `LARGE_FILE_LINES_THRESHOLD`.
- `selectCycleFindings(rows)` — the batch rule above. Pure: timestamps arrive on
  the rows, so no clock is read.
- `marksForFile(path, findings)` → `{ marks, count, lines }`. Match on the
  **un-normalised** path (findings cite real paths). Sort by line then severity
  rank; cap marks at `MAX_FINDING_MARKS_PER_FILE`; `count` is **uncapped**;
  `lines` is the deduped ascending list for `finding_lines`.
- `worstSeverityRank(marks)` — `Math.min`, or `+Infinity` when empty.
- `sortWithinGroup(files)` — the five comparators; returns a **new** array.
- `buildSplitSuggestion(files)`, `buildSmartDiff(files, findings)` — as specified
  above. `pseudocode_summary` is **never assigned** (see Step 4).
- `PrFileLike` is a local structural type (`{path, additions, deletions}`), so
  helpers never import a row type from `repository.ts` and stay testable with
  object literals.

### Step 4 — `repository.ts` + `service.ts`

**Files:** both new under `server/src/modules/smart-diff/`.

`SmartDiffRepository(db)` — three read-only methods, owning and re-exporting its
row types:
- `getPull(workspaceId, prId)` — the workspace gate; same query as
  `reviews/repository/pull.repo.ts:9-19`. This **is** the scope check, bo
  `pr_files` and `findings` carry no `workspace_id`.
- `getPrFiles(prId)` — `path, additions, deletions`. **Do not select `patch`** —
  it is the largest column and this response carries no diff text (the client
  already has patches from `GET /pulls/:id`).
- `findingsForPull(prId)` — inner join `findings` → `reviews` on
  `review_id = reviews.id`, filtered by `reviews.pr_id`, selecting
  `{ id, file, startLine, severity, reviewId, agentId, createdAt }`. Join through
  `reviews` bo `findings` has no `pr_id`; `findings_review_idx` covers it. Order
  by `reviews.created_at desc` for readable tests — `selectCycleFindings` must
  not *rely* on it.
- **No writes.** No insert/update/delete/transaction in this file.

`service.ts`:
```ts
/** One member on purpose: Smart Diff makes no model call. Do not add `llm`. */
export interface SmartDiffDeps { repo: SmartDiffRepository }
export function smartDiffDeps(container: { smartDiffRepo: SmartDiffRepository }): SmartDiffDeps
export class SmartDiffService {
  constructor(private deps: SmartDiffDeps) {}
  async forPull(workspaceId: string, prId: string): Promise<SmartDiff>
}
```
`forPull`: `getPull` → `NotFoundError` when absent; then `getPrFiles` +
`findingsForPull` in `Promise.all`; then `selectCycleFindings` and
`buildSmartDiff`. **Orchestration only** — no classification logic here.

**`pseudocode_summary`: omit the key entirely, do not send `null`** — bo the
field is `nullish`, an absent key is valid, and `null` would read as "computed,
found nothing" rather than "this feature does not compute it". Producing it
honestly needs a model call, which rule 5 forbids.

### Step 5 — `routes.ts`, container, registration

**Files:** `smart-diff/routes.ts` (new), `platform/container.ts`,
`modules/index.ts`, `smart-diff/CLAUDE.md` (new).

Container — a lazy getter beside `reviewRepo` (`container.ts:85-126`):
```ts
private _smartDiffRepo?: SmartDiffRepository;
get smartDiffRepo(): SmartDiffRepository {
  return (this._smartDiffRepo ??= new SmartDiffRepository(this.db));
}
```

`routes.ts`, modelled on `conventions/routes.ts:44-60`:
```ts
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService(
    smartDiffDeps({ smartDiffRepo: container.smartDiffRepo }),
  );
  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.forPull(workspaceId, req.params.id);
  });
}
```
`IdParams` from `../_shared/schemas.js` gives a clean 422. **No rate limit** — a
pure read with no spend. No response schema, matching every other GET here.

`modules/index.ts`: one import + one registry entry. Registration is **static** —
`app.ts:169-171` iterates the registry, so nothing else needs editing.

`smart-diff/CLAUDE.md`: no model call ever and why; nothing persisted and why no
cache table; first-match-wins order is the contract; tests are `core` on purpose;
the `path` tie-break is what makes the endpoint deterministic;
`pseudocode_summary` intentionally never populated.

### Step 6 — Tests

**Files:** `test/smart-diff.test.ts`, `test/smart-diff-routes.test.ts` (both
hermetic), `test/smart-diff.it.test.ts` (DB-backed — the suffix is load-bearing;
header comment must say it is skipped without Docker).

`smart-diff.test.ts` — pure helpers, no DB, no mocks. Named tests for:
- each role's representative paths (lockfile, `dist/`, `*.generated.*`,
  migration, `.snap`, binary → boilerplate; CI, `*.config.*`, `package.json`,
  `.env.example`, `routes.ts`, small `index.ts`, locale JSON → wiring; service,
  `.py`, **`foo.test.ts`**, `README.md`, small unknown ext → core);
- **negative matches**: `mylock.json`, `distribution/a.ts`, `myvendor/a.ts` are
  not boilerplate — the `endsWith` bug class;
- a 300-line `index.ts` is `core`, not `wiring` (`MAX_BARREL_LINES`);
- rule 6: a 900-line `data.bin` is boilerplate, a 900-line `service.ts` is core;
- **first-match-wins**: `dist/next.config.js` is boilerplate (rule 2 before 8);
- `isLargeFile`: 299 false / 300 true / 150+151 true, and the threshold sits
  strictly between `AUTO_EXPAND_MAX_LINES` and `MIN_LINES_FOR_GENERATED_GUESS`;
- `sortWithinGroup`: severity order holds regardless of churn; identical files
  sort by path; **the same input shuffled yields identical output** — the
  determinism proof;
- `selectCycleFindings`: two agents 1 min apart both count; a 2-hour-old review
  is dropped; same agent keeps only the newer; duplicates collapse;
- `marksForFile`: `finding_lines` deduped and ascending; `finding_count` counts
  two findings on one line; marks capped while count stays uncapped;
- `buildSplitSuggestion`: false at 399/14, true at 400/15; **a 5000-line lockfile
  alone does not trigger it**;
- `buildSmartDiff` emits three groups in `GROUP_ORDER` including empty ones, and
  its output **parses against `SmartDiff.parse`** — the test that proves producer
  and contract agree.

`smart-diff-routes.test.ts` — mirroring `conventions-routes.test.ts`: a random
uuid returns a body with `error.code` (the envelope proves the plugin registered
— an unregistered route falls through to Fastify's bare 404); a non-uuid returns
**422**.

`smart-diff.it.test.ts` — seed a PR spanning all three roles plus a review with
findings; assert the response parses; group order; `finding_marks` carry the
right severities **and non-empty `finding_id`/`review_id`** (part C depends on
them); `finding_lines` matches; a PR in **another workspace** returns 404; a PR
with no findings gives every file `finding_count: 0`.

Expected delta: +2 hermetic files → 25 files, 209+N tests.

---

## Verification

| When | Command | From | Pass criterion |
|---|---|---|---|
| step 0 | `pnpm arch:check`, `pnpm typecheck`, `pnpm test` | `server/` | record the numbers |
| after 1 | `pnpm typecheck` | `server/` | only the 2 pre-existing errors |
| after 1 | `pnpm typecheck` | `client/` | exit 0 — catches a one-sided vendored edit |
| after 1 | `diff src/vendor/shared/contracts/brief.ts ../client/src/vendor/shared/contracts/brief.ts` | `server/` | **empty** |
| after 5 | `pnpm arch:check` | `server/` | summary line: **0 errors**, warnings ≤ 6 |
| after 5 | `pnpm db:generate` | `server/` | **no new file** — this feature changes no schema |
| after 6 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | all pass; the 209 still green |
| after 6 | `pnpm exec vitest run .it.test` | `server/` | passes; skipped without Docker |

---

## Acceptance

- [ ] **No LLM call anywhere.** None of the five module files imports
      `LLMProvider`, `Provider`, `FeatureModelChoice`, `resolveFeatureModel`,
      `getFeatureModelOverride`, `renderPrompt`, `wrapUntrusted`, or anything
      under `src/adapters/llm/`; `SmartDiffDeps` has exactly one member.
- [ ] Two consecutive requests yield a byte-identical `SmartDiff`, and a shuffled
      input sorts identically — asserted by a test.
- [ ] `finding_marks` (with `finding_id` + `review_id`), `finding_count`, and
      `is_large` are optional; `test/contracts.test.ts:107-118` passes
      **unmodified**; both vendored copies are byte-identical.
- [ ] `finding_lines` equals the deduped ascending set of `finding_marks[].line`.
- [ ] Classification is first-match-wins; `dist/next.config.js` is boilerplate;
      `distribution/`, `myvendor/`, `mylock.json` are **not**; tests are `core`.
- [ ] `is_large` flips at exactly `LARGE_FILE_LINES_THRESHOLD`.
- [ ] `too_big` ignores boilerplate, so a 5000-line lockfile PR does not trigger.
- [ ] The API returns three groups in `core, wiring, boilerplate` order, empty
      ones included.
- [ ] Nothing persisted: `select` only, `pnpm db:generate` produces no migration.
- [ ] Another workspace → 404; non-uuid → 422.
- [ ] `pseudocode_summary` is never populated (key omitted).
- [ ] `arch:check` reports **0 errors** and no more than the 6 baseline warnings.

---

## Out of scope for part A

Any client code (parts B and C) · caching or persisting the result · populating
`PrBrief` · `pseudocode_summary` in any form · content-based classification
(parsing hunks) · rename detection — `pr_files` does not carry it · per-repo
tuning of patterns from Settings.

## Open questions

- Should `finding_count` include dismissed findings? **Assumed yes** — the smart
  diff shows what an agent flagged, and a dismissal is a review decision
  surfaced in the Findings tab. Otherwise it is a `where` clause.
- Is `routes.ts` really `wiring`? **Assumed yes** per the brief; the
  finding-first sort compensates. Flipping it is deleting one entry.
- Is `FINDING_CYCLE_WINDOW_MS` (10 min) the right batch window? A batch running
  longer loses its slowest agent's marks. If long batches prove normal, match on
  `agent_runs.head_sha` rather than widening indefinitely.
