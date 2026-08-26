# 0003 — Why Timeline: brief history across a PR's commits

**Status:** done
**Date:** 2026-08-26
**Mode:** single-agent
**Touches:** `server/src/db/schema/reviews.ts` · `server/src/db/migrations/` (new, hand-written) · `server/src/modules/brief/{repository,service,routes,constants,helpers}.ts` · `server/src/vendor/shared/contracts/brief.ts` + `review-api.ts` (+ both client copies) · `client/src/lib/hooks/reviews.ts` · `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`

## Requirements

Source: the user's stretch goal on `docs/specs/SPEC-02-pr-why-risk-brief.md`
(**Status: approved**) — *"додайте Why Timeline — історію брифів для різних
комітів PR, щоб було видно, як змінювався намір."*

There is no spec section for this. SPEC-02 explicitly forecloses it, and this
plan **supersedes two of its accepted statements**:

- **AC-31** — "produce a new brief and **replace** the stored one". Replacement
  becomes append-with-retention. The observable half of AC-31 (regeneration
  always produces a fresh brief regardless of key match) is **kept**; only
  "replace the stored one" is superseded.
- **Module interactions / Persistence** — "`pr_id` alone as a primary key also
  means one brief per PR — which is what AC-31 requires". No longer true.

Everything else in SPEC-02 stands unchanged, in particular AC-27/AC-28's cache
key (head sha + `indexed_sha`, absent index a distinct value), AC-29/AC-30's
currency rules, AC-33's mid-flight head-sha capture, and AC-45's head pinning.
A spec amendment is out of scope for this plan (see `## Out of scope`).

## Requirements review

- **Retention policy and history depth are undecidable from the repo** —
  `[proceeding as asked]` Nothing in SPEC-02 or the code implies a number. This
  plan proceeds on: **keep at most 10 briefs per PR, prune oldest by
  `generated_at` on insert, no time-based expiry.** 10 ≈ the number of force-pushes
  a PR sees before it merges, and the rows are small (one `jsonb` each, no diff
  content — NFR-4 keeps hunk bodies out). If you want unbounded retention or a
  different depth, only `MAX_BRIEF_HISTORY` in Step 4 changes; no other step moves.
- **Same-key regeneration should replace, not append** — `[recommended]`
  Regenerating twice against an unchanged head sha and an unchanged
  `indexed_sha` produces two rows that describe *the same commit* — noise in a
  timeline whose entire purpose is showing change across commits. Step 4 keys
  the upsert on `(pr_id, head_sha, indexed_sha)` so a same-key regeneration
  still replaces (preserving AC-31's user-visible behaviour for the common
  "the model got it wrong, try again" case) and a *different* head sha appends.
  This is the shape that makes the timeline mean "intent per commit" rather than
  "every button press".
- **`PrHistory` is the wrong shape and must not be repurposed** — `[recommended]`
  `contracts/brief.ts:136-149` `PrHistoryItem` is `{ pr_number, title, merged_at,
  author, files_overlap, notes }` — *other PRs touching the same files*, the
  "Prior PRs touching these files" panel SPEC-02 listed under Non-goals. It is
  not briefs-over-time and shares no field with one. Step 1 adds a new
  `BriefTimelineEntry`; `PrHistory` stays exported and unused exactly as SPEC-02
  resolved decision 5 left it. Deleting it remains a separate decision.
- **`is_current` is computed and never rendered** — `[recommended]`
  The server returns it (`brief/service.ts:147`, `routes.ts:64`) and the client
  types it (`hooks/reviews.ts:168`), but `PrBriefCard.tsx` reads only
  `provenance.*` — a stale brief renders identically to a current one, which
  AC-30 asks the system not to do. The timeline makes this worse (an old entry
  is stale by construction), so Step 8 renders a stale marker. Small, in-scope,
  and the timeline is unreadable without it.
- **`pr_brief` may now hold rows — migration 0016's "empty in every
  environment" no longer applies** — `[proceeding as asked]` 0016 relied on it
  to add `head_sha text NOT NULL` with no backfill. This change alters a PRIMARY
  KEY on a possibly-populated table, so Step 3 is a hand-written migration with
  a real dedup step, not `db:generate` output taken as-is.

## Problem

`prBrief.prId` is the PRIMARY KEY (`server/src/db/schema/reviews.ts:84-86`), and
`BriefRepository.upsertBrief` does `onConflictDoUpdate({ target: t.prBrief.prId })`
(`brief/repository.ts`, last method) — so every regeneration **overwrites** the
previous brief. A reviewer on a PR that has been force-pushed three times can see
only the newest synthesis; the three earlier statements of intent are gone.

The data that would distinguish them is already persisted and already correct:
migration `0016_old_shooting_star.sql` added `head_sha`, `indexed_sha`, and
`generated_at` as real columns, and `service.ts#doGenerate` writes the head sha
**captured before the model call** (AC-33), so each row already names the exact
commit it describes. Only the key shape and the overwrite prevent history.

## Approach

Widen the primary key to `(pr_id, head_sha, indexed_sha)` and add a bounded
retention prune, then expose the retained rows as a second read.

- **Persistence.** Drop the `pr_id` PK, add a composite one. `indexed_sha` is
  nullable and Postgres forbids a NULL in a PRIMARY KEY, so the key column is a
  generated/normalised `indexed_sha_key text NOT NULL` defaulting to the empty
  string — `''` is not a valid sha, so it is an unambiguous stand-in for AC-28's
  "no index" value while `indexed_sha` itself stays nullable and keeps carrying
  the real semantics for reads. A partial unique index on
  `(pr_id, head_sha, indexed_sha)` was rejected — `ON CONFLICT` needs a single
  inferable arbiter, and two partial indexes cannot serve one `onConflictDoUpdate`.
- **Read split.** `getBrief` keeps its exact signature and returns the **latest**
  row (`ORDER BY generated_at DESC LIMIT 1`), so `GET /pulls/:id/brief`,
  `is_current`, and the whole shipped card are behaviourally unchanged. A new
  `listBriefs` + `GET /pulls/:id/brief/timeline` returns the retained rows
  newest-first as lightweight entries.
- **Timeline entries are trimmed, not full briefs.** An entry carries
  `head_sha`, `indexed_sha`, `generated_at`, `risk_level`, `what`, and
  `is_current` — enough to show "how the intent changed" without shipping ten
  full `risks[]`/`review_focus[]` payloads to render a collapsed list.
  Expanding an entry is out of scope (see `## Out of scope`).
- **Client.** A `BriefTimeline` sub-component inside the existing `PrBriefCard`
  folder, rendered under the current brief. Not a new top-level card — AC-49
  fixes what sits above the intent/blast grid, and the timeline is the same
  card's history.

## Affected packages and modules

| Package | Path | What changes | Layer (backend only) |
|---|---|---|---|
| server | `src/db/schema/reviews.ts` | `prBrief`: composite PK, `indexedShaKey` column, `prId` index | 5 — Infrastructure |
| server | `src/db/migrations/0017_*.sql` (new) | hand-written key change + dedup | 5 |
| server | `src/modules/brief/repository.ts` | `getBrief` → latest row; new `listBriefs`, `pruneBriefs`; `upsertBrief` retargets | 5 |
| server | `src/modules/brief/service.ts` | new `getTimeline`; `doGenerate` calls prune | 4 — Application Services |
| server | `src/modules/brief/routes.ts` | new `GET /pulls/:id/brief/timeline` | 5 |
| server | `src/modules/brief/constants.ts` | `MAX_BRIEF_HISTORY` | 5 (constants) |
| server | `src/vendor/shared/contracts/brief.ts` | new `BriefTimelineEntry` | 1 — Domain Model |
| server | `src/vendor/shared/contracts/review-api.ts` | new `BriefTimelineResponse` | 1 |
| client | `src/vendor/shared/contracts/{brief,review-api}.ts` | **identical** copies of both | — |
| client | `src/lib/hooks/reviews.ts` | `useBriefTimeline` | — |
| client | `.../PrBriefCard/BriefTimeline.tsx` (new) + `styles.ts`, `index.ts` | timeline list | — |
| client | `.../PrBriefCard/PrBriefCard.tsx` | render timeline; stale marker | — |
| client | `messages/en/brief.json` | `timeline.*` keys | — |

`@devdigest/shared` is **vendored twice** and `server/` is canonical. Both
contract edits are two-file edits; verify with `diff` (Step 9).

## Architectural constraints

- `repository.ts` owns all SQL. `service.ts` must not import `drizzle-orm` or
  `db/**` (`service-no-sql`); the prune is a repository method taking
  `(prId, keep)`, never a query built in the service.
- The repository returns domain-shaped objects, never Drizzle rows —
  `listBriefs` maps to `BriefTimelineEntry[]` inside `repository.ts`, matching
  how `getBrief` already reassembles `provenance` from columns + `json`.
- `service.ts` must not import another module's `service.ts`
  (`no-cross-module-service`, **severity error**). `getTimeline` reuses the
  existing `deps.blastReader` structural port for the current `indexed_sha`; it
  must not reach for `BlastService`. Adding a new dep to `BriefDeps` is not
  needed and must not happen.
- `routes.ts` stays the only HTTP layer: no status codes or `reply` in the
  service; not-found stays `NotFoundError` from `platform/errors.ts`.
- Contracts (`vendor/shared/contracts/**`) import `zod` only.
- Client: no `fetch` in a component — the timeline goes through
  `src/lib/api.ts` via a `src/lib/hooks/reviews.ts` hook. All strings from
  `messages/en/brief.json`. Every async surface shows a loader
  (`client/CLAUDE.md`); the timeline's own load gets a `Skeleton` with a named
  `role="status"` line. The `why.*` subtree in `brief.json` belongs to git-why —
  do not touch it.
- Colocation: `BriefTimeline.tsx` lives in the existing `PrBriefCard/` folder.
  There is no `src/features/` in this repo — where the `ui-frontend-architecture`
  skill's `features/*` canon disagrees, `client/CLAUDE.md` wins.

Enforced by: `cd server && pnpm arch:check`. The frontend has no automated
gate — these constraints are the gate.

## Implementation steps

### Step 1 — contract: `BriefTimelineEntry` (both vendored copies)
- **Files:** `server/src/vendor/shared/contracts/brief.ts` (edit),
  `client/src/vendor/shared/contracts/brief.ts` (edit, identical)
- **Do:** Append after `PrBrief`:
  ```ts
  export const BriefTimelineEntry = z.object({
    head_sha: z.string(),
    indexed_sha: z.string().nullable(),
    generated_at: z.string(),
    risk_level: RiskSeverity,
    what: z.string(),
    is_current: z.boolean(),
  });
  export type BriefTimelineEntry = z.infer<typeof BriefTimelineEntry>;
  ```
  `nullable`, not `nullish` — an absent index is an ANSWERED `null` (AC-28),
  mirroring `BriefProvenance.indexed_sha`. Do **not** touch `PrHistory`: it is a
  different feature's shape (Requirements review) and SPEC-02 resolved decision 5
  keeps it.
- **Done when:** both files are byte-identical and `RiskSeverity` is imported/in
  scope in each.

### Step 2 — contract: `BriefTimelineResponse` (both vendored copies)
- **Files:** `server/src/vendor/shared/contracts/review-api.ts` (edit),
  `client/src/vendor/shared/contracts/review-api.ts` (edit, identical)
- **Do:** Next to `PrBriefRecord` (line ~86), add
  `export const BriefTimelineResponse = z.object({ entries: z.array(BriefTimelineEntry) });`
  plus its `z.infer` type. An object, not a bare array — matches
  `ContextDocReader.listDocuments`'s `{ docs }` shape and leaves room for a
  `truncated` flag without a breaking change. Import `BriefTimelineEntry` from
  `./brief.js`. Confirm both `vendor/shared/index.ts` files re-export it (they
  re-export the contract modules wholesale — check rather than assume).
- **Done when:** `BriefTimelineResponse` resolves from `@devdigest/shared` in
  both packages.

### Step 3 — migration: widen the primary key (hand-written)
- **Files:** `server/src/db/schema/reviews.ts` (edit),
  `server/src/db/migrations/0017_why_timeline.sql` (new),
  `server/src/db/migrations/meta/_journal.json` (edit)
- **Do:** In `reviews.ts`, change `prBrief`: `prId` loses `.primaryKey()` and
  keeps `.notNull().references(() => pullRequests.id, { onDelete: 'cascade' })`;
  add `indexedShaKey: text('indexed_sha_key').notNull().default('')`; add a
  second table argument returning
  `{ pk: primaryKey({ columns: [t.prId, t.headSha, t.indexedShaKey] }), prIdx: index('pr_brief_pr_idx').on(t.prId) }`.
  Import `primaryKey` from `drizzle-orm/pg-core`. Comment `indexedShaKey` as: a
  PK column cannot be NULL, so `''` stands in for AC-28's "no index"; the real
  semantics stay on the nullable `indexed_sha`, which every read uses.

  Write the SQL by hand — `pr_brief` may hold rows, so 0016's "empty table, no
  backfill" reasoning does not carry:
  ```sql
  ALTER TABLE "pr_brief" ADD COLUMN "indexed_sha_key" text NOT NULL DEFAULT '';--> statement-breakpoint
  UPDATE "pr_brief" SET "indexed_sha_key" = COALESCE("indexed_sha", '');--> statement-breakpoint
  ALTER TABLE "pr_brief" DROP CONSTRAINT "pr_brief_pkey";--> statement-breakpoint
  ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_pkey" PRIMARY KEY ("pr_id", "head_sha", "indexed_sha_key");--> statement-breakpoint
  CREATE INDEX "pr_brief_pr_idx" ON "pr_brief" ("pr_id");
  ```
  No dedup step is needed **before** the PK add — the old `pr_id` PK guarantees
  at most one row per PR, so no duplicate `(pr_id, head_sha, indexed_sha_key)`
  can already exist. Every pre-existing row is preserved and becomes the first
  timeline entry for its PR. Verify the real constraint name first with
  `\d pr_brief` (or `SELECT conname FROM pg_constraint WHERE conrelid =
  'pr_brief'::regclass`) — if it is not `pr_brief_pkey`, use what is there.

  Run `pnpm db:generate` to see what Drizzle would emit and to get the journal
  entry shape, but **keep the hand-written SQL** if the generated file differs;
  drizzle-kit renders a PK change as drop-and-recreate without the backfill
  `UPDATE`, which would leave the column at `''` for rows that have an index.
- **Done when:** `cd server && pnpm db:migrate` applies cleanly against a DB
  that already contains a `pr_brief` row, and that row survives with
  `indexed_sha_key` equal to its `indexed_sha` (or `''`).

### Step 4 — repository: append, prune, list
- **Files:** `server/src/modules/brief/repository.ts` (edit),
  `server/src/modules/brief/constants.ts` (edit)
- **Do:** Add `export const MAX_BRIEF_HISTORY = 10;` to `constants.ts`
  (documented as the retention depth this plan chose — Requirements review).

  In `repository.ts`:
  - `getBrief(prId)` — unchanged signature and return type, but now
    `.orderBy(desc(t.prBrief.generatedAt)).limit(1)`. Everything downstream
    (`is_current`, the card) keeps working untouched.
  - `upsertBrief` — write `indexedShaKey: indexedSha ?? ''` alongside the
    existing values and retarget the conflict to
    `target: [t.prBrief.prId, t.prBrief.headSha, t.prBrief.indexedShaKey]`.
    Same key → replace (AC-31's user-visible behaviour preserved); new head sha
    → append.
  - `listBriefs(prId, limit)` — `ORDER BY generated_at DESC LIMIT $limit`,
    mapped **in the repository** to `{ head_sha, indexed_sha, generated_at,
    risk_level, what }` read from the columns plus `(row.json as {body: PrBrief}).body`.
    Return type is a local `TimelineRow` without `is_current` — currency is a
    service-layer judgement, not a stored fact.
  - `pruneBriefs(prId, keep)` — delete rows for `prId` whose `generatedAt` is
    older than the `keep`-th newest. Express it as a subselect of the ids to
    keep, not as a JS round-trip. Because the PK is composite there is no single
    id column: delete by `NOT IN` over the `(head_sha, indexed_sha_key)` pairs
    to keep, or by `generatedAt <` the cutoff timestamp read from the same
    ordered query — the timestamp form is simpler and correct here since
    `generated_at` is `defaultNow()` and monotonically increasing per PR.
- **Done when:** `pnpm typecheck` in `server/` is at baseline (2 pre-existing
  errors, `db/migrate.ts:38` and `db/seed.ts:499`).

### Step 5 — service: `getTimeline`, prune on generate
- **Files:** `server/src/modules/brief/service.ts` (edit)
- **Do:** Add
  `async getTimeline(workspaceId: string, prId: string): Promise<BriefTimelineEntry[]>`:
  1. `getPull` gate first — `NotFoundError` when absent, exactly as `getBrief`
     does. This is the only workspace scope check `pr_brief` gets (the table
     carries no `workspace_id`).
  2. `repo.listBriefs(prId, MAX_BRIEF_HISTORY)`.
  3. Resolve the current `indexed_sha` through `deps.blastReader.forPull` inside
     a `try`/`catch`; on throw, treat currency as unknowable and set
     `is_current: false` on **every** entry — the same rule `getBrief` already
     applies (`service.ts:135-143`), so the two reads never disagree.
  4. Map each row to `BriefTimelineEntry` with
     `is_current = row.head_sha === pull.headSha && row.indexed_sha === currentIndexedSha`.
     `===` on `null` both sides is what makes AC-28's distinct value work — do not
     use `==` and do not coerce through `indexed_sha_key`.

  In `doGenerate`, immediately after the existing `upsertBrief` call, add
  `await this.deps.repo.pruneBriefs(prId, MAX_BRIEF_HISTORY);`. After, not
  before — a prune that runs first could delete a row the upsert then fails to
  replace. Do not change the captured-head-sha behaviour (AC-33) or the
  `inFlight` guard (AC-58).

  A concurrent change is adding `MAX_BRIEF_INPUT_TOKENS` and a
  `dropped_sections`-style field on `BriefProvenance` to these same files —
  locate the anchors by name, not by line number, and leave its edits intact.
- **Done when:** `pnpm arch:check` in `server/` still reports
  `0 errors, 6 warnings` on its summary line.

### Step 6 — route: `GET /pulls/:id/brief/timeline`
- **Files:** `server/src/modules/brief/routes.ts` (edit)
- **Do:** Register alongside the existing `GET /pulls/:id/brief`, with
  `{ schema: { params: IdParams } }`, returning
  `Promise<BriefTimelineResponse>` as `{ entries }`. A pure read — **no**
  `config.rateLimit`, matching `GET /pulls/:id/brief` and `/pulls/:id/blast`;
  the rate limit belongs to the money-spending `POST .../generate` only.
  `getContext(container, req)` for the workspace id, as both existing handlers do.
- **Done when:** the route is listed by the app's route table and returns
  `{ entries: [] }` for a PR with no brief (an empty timeline is not a 404 —
  only a missing PR is).

### Step 7 — client hook
- **Files:** `client/src/lib/hooks/reviews.ts` (edit)
- **Do:** Add next to `useBrief`:
  ```ts
  export function useBriefTimeline(prId: string | null | undefined) {
    return useQuery({
      queryKey: ["pr-brief-timeline", prId],
      queryFn: () => api.get<BriefTimelineResponse>(`/pulls/${prId}/brief/timeline`),
      enabled: !!prId,
    });
  }
  ```
  Then extend `useGenerateBrief`'s `onSuccess` to invalidate
  `["pr-brief-timeline", prId]` as well as `["pr-brief", prId]` — without it a
  fresh generation adds a timeline entry the UI never shows.
- **Done when:** `pnpm typecheck` in `client/` exits 0.

### Step 8 — client: `BriefTimeline` + stale marker
- **Files:** `.../PrBriefCard/BriefTimeline.tsx` (new),
  `.../PrBriefCard/styles.ts` (edit), `.../PrBriefCard/index.ts` (edit),
  `.../PrBriefCard/PrBriefCard.tsx` (edit),
  `client/messages/en/brief.json` (edit)
- **Do:** `BriefTimeline({ prId }: { prId: string | null })` calls
  `useBriefTimeline`, renders nothing when there are fewer than 2 entries (one
  entry is just the brief already shown above), and otherwise renders a
  newest-first list. Each row: short head sha (`slice(0, 7)`, `className="mono"`),
  localised `generated_at`, the risk-level **text** label reusing
  `RISK_LEVEL_COLOR` from `./constants` (text label plus colour, never colour
  alone — AC-50/NFR-19), and the entry's `what` as the "how the intent changed"
  line. Mark `is_current: false` rows with a text badge, not colour alone.
  While loading: `Skeleton` plus a `role="status"` line reading
  `t("timeline.loading")`.

  In `PrBriefCard.tsx`: render `<BriefTimeline prId={prId} />` at the end of the
  present-brief branch (after the documents row), and — the `is_current` gap
  from Requirements review — when `data.is_current === false`, render a
  `role="status"` notice reading `t("timeline.notCurrent")` next to the existing
  `metaRow`. Do not render the timeline in the empty, loading, error, or
  `generate.isPending` branches.

  New `brief.json` keys under a `timeline` object: `title`, `loading`,
  `current`, `stale`, `notCurrent`, `empty`. Leave every existing key alone,
  and do not touch `why.*` (git-why).
- **Done when:** `pnpm lint` in `client/` shows 0 errors and the 3 pre-existing
  warnings, and no user-facing string is inline in JSX.

### Step 9 — tests and vendor-copy verification
- **Files:** `server/src/modules/brief/brief.it.test.ts` (edit),
  `.../PrBriefCard/BriefTimeline.test.tsx` (new)
- **Do:** Integration (`*.it.test.ts` — the filename is what puts it in the DB
  lane; it needs Docker and is skipped cleanly without it, as the file's
  existing header already handles): generate a brief, mutate the seeded PR's
  `head_sha`, generate again, then assert `GET /pulls/:id/brief/timeline`
  returns **2** entries newest-first with the newest `is_current: true` and the
  older `is_current: false`; assert `GET /pulls/:id/brief` still returns the
  newest one; assert a second generation at the **same** head sha and
  `indexed_sha` leaves the count at 2 (same-key replace); assert that
  generating past `MAX_BRIEF_HISTORY` distinct head shas leaves exactly
  `MAX_BRIEF_HISTORY` rows. Add one case with `indexed_sha: null` to prove
  AC-28 survives the `indexed_sha_key` translation — a brief stored with no
  index must not be reported current once an index exists.

  Component test: two entries render two rows; one entry renders nothing;
  loading renders the `role="status"` line.

  Then verify the vendored copies are identical:
  ```
  diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
  diff server/src/vendor/shared/contracts/review-api.ts client/src/vendor/shared/contracts/review-api.ts
  ```
- **Done when:** both `diff`s print nothing and the suites match the
  verification table below.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| before any edit | `pnpm typecheck`, `pnpm arch:check`, `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | record the baseline (below) |
| before any edit | `pnpm lint && pnpm test` | `client/` | record the baseline (below) |
| after step 2 | `diff` both contract pairs (Step 9) | repo root | no output |
| after step 3 | `pnpm db:migrate` | `server/` | applies clean; a pre-existing `pr_brief` row survives with `indexed_sha_key` = its `indexed_sha` or `''` |
| after step 5 | `pnpm arch:check` | `server/` | summary line still `0 errors, 6 warnings` — read the line, never the exit code (it is always 0) |
| after step 6 | `pnpm typecheck` | `server/` | exactly the 2 baseline `error TS`, no new ones |
| after step 6 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | 430 pass / 2 fail — the 2 pre-existing in `test/project-context-routes.test.ts`, no others |
| after step 8 | `pnpm lint` | `client/` | 0 errors, 3 pre-existing warnings |
| after step 8 | `pnpm typecheck` | `client/` | exit 0 |
| after step 9 | `pnpm exec vitest run .it.test` | `server/` | brief suite passes; skipped cleanly if Docker is unavailable — a skip is not a pass, say which happened |
| after step 9 | `pnpm test` | `client/` | ≥ 227 pass, 0 fail |
| final | `pnpm build` | `client/` | exit 0 |

Baseline to record before starting: `server` typecheck error count and the two
file:line locations; `arch:check`'s full summary line; `server` hermetic
pass/fail counts and the names of the 2 failures; `client` lint error/warning
counts and test count. Judge every later run by the delta. Never pipe a check
into `tail`/`head` — it drops the exit code.

## Acceptance
- [ ] Regenerating a brief after the PR's head sha changed leaves **both**
      briefs readable; the older one is not overwritten.
- [ ] Regenerating twice against an unchanged head sha and `indexed_sha`
      produces one row, not two (AC-31's user-visible behaviour preserved).
- [ ] `GET /pulls/:id/brief` returns the newest brief and its `is_current` is
      unchanged in meaning (AC-29, AC-30 still hold).
- [ ] A brief stored with `indexed_sha: null` is never reported current once an
      index exists (AC-28 survives the `indexed_sha_key` translation).
- [ ] At most `MAX_BRIEF_HISTORY` briefs are retained per PR; the oldest are
      pruned on generate.
- [ ] Rows that existed before the migration survive it and appear as the
      earliest timeline entry for their PR.
- [ ] The card shows the timeline only when 2+ entries exist, marks non-current
      entries with a text label, and shows a notice when the displayed brief is
      itself not current.
- [ ] Both vendored copies of both contract files are byte-identical.
- [ ] `arch:check` summary line is unchanged from baseline.

## Out of scope
- **Amending `docs/specs/SPEC-02-pr-why-risk-brief.md`.** This plan supersedes
  AC-31's "replace" clause and the `pr_id`-PK statement in Module interactions;
  recording that in the spec is `spec-creator`'s job, not this plan's.
- **Expanding a timeline entry to its full brief** (risks, review focus,
  provenance). Entries are trimmed by design; a detail view is a follow-up.
- **A diff between two briefs** ("what changed between commit A's intent and
  commit B's"). The timeline shows the sequence; comparing two is a separate
  feature with its own UI question.
- **Deleting `PrHistory`** — SPEC-02 resolved decision 5 stands.
- **Exposing the timeline over MCP** — SPEC-02 resolved decision 3 keeps the
  brief off MCP entirely.
- **A new e2e flow.** Existing flows do not cover the brief card at all; adding
  timeline coverage there is a separate change.
- **Time-based expiry or a workspace-configurable retention setting.**

## Open questions
- **Retention depth: is 10 right?** Proceeding on `MAX_BRIEF_HISTORY = 10` with
  prune-oldest-on-insert and no time-based expiry. Only the constant in Step 4
  changes if you want another number; unbounded retention means deleting
  `pruneBriefs` and its call, which is also a one-line change.
- **Should a same-key regeneration append instead of replace?** Proceeding on
  **replace** (Requirements review) — two rows for one commit make the timeline
  read as a log of button presses rather than a history of intent. If you want
  every generation retained, Step 4's conflict target becomes a plain insert and
  Step 9's "count stays at 2" assertion inverts.
- **Does the timeline need to survive a force-push that rewrites a head sha out
  of existence?** Proceeding on yes-by-default: rows are keyed by the sha they
  described and are never reconciled against the PR's current commit list, so a
  brief for an abandoned sha stays in the timeline until pruned by depth. That
  is arguably the point — it is what shows the intent changing — but it does
  mean a timeline can name a commit no longer reachable from the PR head.
