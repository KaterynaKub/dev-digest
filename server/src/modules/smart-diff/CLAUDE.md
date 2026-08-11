# modules/smart-diff

Classifies a PR's changed files into `core` / `wiring` / `boilerplate`, sorts
within each group by review priority, and proposes a split when the reviewable
part of the diff is too large. Serves `GET /pulls/:id/smart-diff`.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md`,
`../../../specs/0005a-smart-diff-server.md` first.

## Conventions (not obvious from code)

- **No model call, ever.** Classification is path patterns plus integer
  arithmetic — all pure functions in `helpers.ts`. `SmartDiffDeps` has exactly
  one member (`repo`); do not add `llm`, and never import
  `LLMProvider`/`Provider`/`resolveFeatureModel`/anything under `adapters/llm/`
  into any of this module's five files.
- **Nothing is persisted.** `repository.ts` is `select`-only — no
  insert/update/delete/transaction. There is deliberately no cache table: the
  computation is cheap enough to redo on every request.
- Classification (`classifyPath`) is a **first-match-wins ordered scan** over
  13 rules. That order IS the contract — it is what makes a result explainable
  ("boilerplate *because* it matched `pnpm-lock.yaml`", not "boilerplate for
  some combination of reasons"). Adding a rule means choosing where in the
  list it goes, not just adding it.
- **Tests are `core` on purpose** — a test is hand-written intent, and a
  weakened test is exactly the defect class a "skim" group would conceal. This
  is a deliberate divergence from `repo-intel`'s `JUNK_PATH_PATTERNS`, which
  excludes tests for a different job (conventions sampling) — see the header
  comment in `constants.ts`.
- Sorting within a group (`sortWithinGroup`) is a **total** order ending in
  **path ascending** — never omit that last tie-break. Without it, ties depend
  on the order `pr_files` came back in, and Postgres promises none without
  `ORDER BY`. This is what makes two consecutive requests byte-identical.
- `split_suggestion.total_lines` counts churn over EVERY file including
  boilerplate (so it matches GitHub's number); `too_big` counts core+wiring
  ONLY, so a multi-thousand-line lockfile bump never trips it.
- `pseudocode_summary` is **intentionally never populated** — the key is
  omitted entirely, never set to `null`. Producing it honestly needs a model
  call, which this module forbids itself. `null` would read as "computed,
  found nothing"; an absent key reads as "this feature does not compute it".
- Findings are matched on the **newest review batch only**, not all-time and
  not only-the-newest: `selectCycleFindings` keeps the newest review per
  `agent_id` within `FINDING_CYCLE_WINDOW_MS` of the newest review's
  `created_at`, then dedupes by `(file, start_line, severity)`. Deliberately
  NOT matched on `head_sha` — `reviews` has no such column (only
  `agent_runs` does).

## Use when

- The classification rule table and rationale per rule → read
  `../../../specs/0005a-smart-diff-server.md`
- Finding/review data model → read `../reviews/CLAUDE.md`
