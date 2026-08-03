# server — insights

Durable, non-obvious facts discovered while working in this package. Append a
new section as you find them; delete one when it stops being true.

## Format

```markdown
## <The fact, stated as a claim>

**Found:** YYYY-MM-DD · **Applies to:** src/path

What happens, then why (the mechanism), then the rule that follows.
```

## Rules

- One fact per section. Title states the fact, not the topic.
- Only what the code does not already say plainly — no restating logic.
- Not change history (that is git) and not planned work (that is `specs/`).
- A wrong insight is worse than a missing one: delete on invalidation.

---

## Trap: a cancelled run's already-spent money is never recorded

**Found:** 2026-08-01 · **Applies to:** src/modules/reviews/run-executor.ts

`runOneAgent` only learns a run's cost from the `ReviewOutcome` that
`reviewPullRequest` returns. Cancelling mid-way through a map-reduce throws
`RunCancelledError` instead of returning, so the chunks already paid for are
lost with the stack — the catch branch writes `costUsd: null` and the run shows
"—". This is deliberate (an unfinished run must not display a figure we cannot
stand behind), but it means per-run costs UNDER-report: the OpenRouter dashboard
will show spend that no `agent_runs` row accounts for. Recovering it needs the
partial cost carried out through the error (or a mutable accumulator passed
into `reviewPullRequest`) — do not "fix" it by writing 0.

## Trap: `costUsd` of 0 is a real price, not a missing one

**Found:** 2026-08-01 · **Applies to:** src/modules/pulls/status.ts

The price book lists genuinely free models (e.g. `z-ai/glm-4.7-flash` at 0/0),
so a completed run can legitimately cost exactly `0`. Every cost check therefore
uses `== null` / `!= null`; a truthiness test (`if (cost)`) silently reclassifies
a free run as "unknown" and renders "—" where "$0" is correct. The same applies
when folding runs into a PR-list total: `SUM()` in SQL would also hide the
difference between "no price" and "zero price", which is why `foldCycleCost`
aggregates in JS and tracks the source separately.

## Decision: `agent_runs.head_sha` is written at creation, and old rows stay NULL

**Found:** 2026-08-01 · **Applies to:** src/modules/reviews/repository/run.repo.ts

The PR-list COST column sums the runs of one review *cycle*, defined as the runs
whose `head_sha` equals `pull_requests.last_reviewed_sha`. The column is set in
`createAgentRun`, not at completion, because the author can push again while a
run is in flight and the diff was taken against the commit at queue time. Rows
written before this column existed are NULL, match no cycle, and correctly show
"—" — they were deliberately not backfilled, since the only available surrogate
(`last_reviewed_sha`) would attribute old runs to a commit they never reviewed.

## Trap: removing `Container` from services pushes the violation, it does not delete it

**Found:** 2026-08-03 · **Applies to:** src/modules/*/service.ts, .dependency-cruiser.cjs

Converting the services from `constructor(container: Container)` to explicit
port objects cleared `service-no-container` (7 → 0) and every `no-circular`
cycle except one — the cycles existed *because* `container.ts` did
`new RepoIntelService(this)`.

But the obvious first step, injecting `db: Db`, traded one violation for
another: `service-no-sql` went 3 → 9, because `Db` lives in `src/db/client.ts`
and the rule forbids all of `^src/db/`. Injecting the **repository** instead of
the DB handle is what actually satisfies the layer. The same shuffle happens one
level up: building repositories in `routes.ts` then trips
`routes-no-persistence`, so they belong on the Container as lazy getters
(`container.pollingRepo`) and `routes.ts` only forwards them.

Net: 20 → 6 violations. Check the *whole* summary line after such a refactor —
a rule that improves while its neighbour degrades looks like progress in the
diff and is not.

## Trap: `tsc -p tsconfig.json` does not cover `test/` — services can typecheck green and be broken

**Found:** 2026-08-03 · **Applies to:** tsconfig.json, test/*.test.ts

`server/tsconfig.json` sets `"include": ["src/**/*.ts"]`, so `pnpm typecheck`
never sees `test/`. After changing every service constructor, typecheck was
clean while four test files still passed the old shape. Only `pnpm test` caught
it. Running `tsc` over `test/*.test.ts` directly does not substitute: without the
project's `paths`, every `@devdigest/shared` import fails with TS2307 and buries
the real errors. Change a constructor signature → run the suite, not the
typechecker.

The tests that broke were also the ones reaching furthest around the DI:
`(svc as unknown as { repo: X }).repo = stub` to patch a private field after
building the service from an `as never` container. With ports injected, that
patching is gone — the stub is passed in as `repo`.
