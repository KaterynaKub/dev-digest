# modules/blast

Maps a PR's changed symbols to their downstream callers, HTTP endpoints, and
cron jobs, using the `repo-intel` index that already exists — no parsing, no
indexing of its own. Serves `GET /pulls/:id/blast`.

## Before answering

Search `../../../docs/`, `../../../specs/0007-blast-radius.md`,
`../../../INSIGHTS.md`, `../repo-intel/CLAUDE.md` first.

## Conventions (not obvious from code)

- **Facade only.** This module talks to `repo-intel` ONLY through the
  `RepoIntel` port (`repoIntel.getBlastRadius` / `repoIntel.getIndexState`).
  It never imports `repo-intel/pipeline/**`, `adapters/astgrep/**`,
  `adapters/codeindex/**`, or any index table — that is `repo-intel/CLAUDE.md`'s
  rule, and this module has no exception to it.
- **No model call, ever.** `BlastDeps` has exactly two members (`repo`,
  `repoIntel`); do not add `llm`. Same discipline as `smart-diff/CLAUDE.md`.
- **Nothing is persisted.** `repository.ts` is `select`-only — two queries,
  `getPull` and `getPrFiles` (paths only, no `patch`/additions/deletions —
  blast needs nothing else). No cache table; `repo-intel` already owns the
  expensive cache.
- **The one new piece of logic is the flat→grouped transform**, entirely in
  `helpers.ts#buildBlastRadius`. `repo-intel`'s `BlastResult` is a flat list
  of caller rows carrying `viaSymbol`; `BlastRadius` (the HTTP contract) is
  grouped per changed symbol with `endpoints_affected`/`crons_affected`
  attributed via `factsByFile`. `helpers.ts` never imports
  `repo-intel/types.ts` directly — it takes structurally-typed
  `BlastResultLike`/`IndexStateLike` so this module stays independently
  testable and the dependency-cruiser boundary stays honest (types only, no
  runtime import of the facade module into pure helpers).
- **Index state is data, never inferred as "full" by default.** A blank
  `downstream` array means two DIFFERENT things depending on
  `index_status`/`degraded`/`reason` — see `specs/0007-blast-radius.md` §4.2
  (decision: variant B) for the full mapping table. The single most important
  invariant this module protects: two requests with an equally-empty
  `downstream`, one on a `full` index and one on a `partial`/`degraded`/`failed`
  index, MUST produce different `degraded`/`reason`/`summary` — see
  `test/blast-helpers.test.ts`'s "KEY NEGATIVE TEST".
- **`service.ts` degrades, never throws.** `repoIntel.getBlastRadius` and
  `repoIntel.getIndexState` are read independently via `Promise.allSettled` —
  a throw from either is caught and mapped to `index_status: 'failed'`
  (blast) / `indexState: null` (state), never propagated as a 500 and never
  silently downgraded to an empty-but-unlabelled result.
- **A PR with zero changed files is a `full`-index empty result, not a
  degraded one** — `service.ts#forPull` returns early WITHOUT calling
  `repoIntel` at all in that case. "PR touched nothing" is a fact, not a data
  gap.
- Sorting in `helpers.ts` is a **total** order ending in a lexicographic
  tie-break at every level (`downstream` → caller count desc, then max rank
  desc, then symbol name asc; `callers` within a symbol → rank desc, file asc,
  line asc; `endpoints_affected`/`crons_affected` → lexicographic asc). This is
  what makes two consecutive requests byte-identical — same discipline as
  `smart-diff/helpers.ts#sortWithinGroup`.
- Limits (`constants.ts`) are applied **after** sorting, so a symbol/caller
  with the least importance is what gets dropped, never an arbitrary one.
  `MAX_CALLERS_PER_SYMBOL` duplicates the cap `repo-intel/service.ts`'s
  persistent path already applies — this helper does not trust that slice to
  have happened (the ripgrep-degraded path applies no such cap of its own).

## Use when

- The index-state mapping table and acceptance criteria → read
  `../../../specs/0007-blast-radius.md`
- What `repo-intel` already guarantees (persistent vs ripgrep-degraded paths,
  `factsByFile`) → read `../repo-intel/CLAUDE.md` and `../repo-intel/types.ts`
