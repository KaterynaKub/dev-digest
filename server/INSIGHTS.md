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

## Trap: `pnpm <any script>` hard-fails after adding a dependency with a native build script, until `approve-builds` runs

**Found:** 2026-08-03 · **Applies to:** package.json, pnpm-workspace.yaml

Adding a new dependency (e.g. `yauzl`, transitively pulling `ssh2`) makes
`pnpm typecheck` / `pnpm test` / `pnpm arch:check` / `pnpm db:generate` all
fail immediately with `[ERR_PNPM_IGNORED_BUILDS]`, before running any of the
actual command — pnpm now refuses to proceed until every package with an
install/postinstall script is explicitly allow- or deny-listed. The fix is
`pnpm approve-builds --all` (writes the allowlist into `pnpm-workspace.yaml`'s
`allowBuilds:` block), not reinstalling or downgrading anything. `ssh2`'s
native crypto binding fails to compile on a machine without the MSVC toolchain
(`node-gyp` can't find Visual Studio) — that failure is non-fatal (falls back
to the pure-JS binding) and does not block the approval step. Do not mistake
either failure for a real dependency problem.

## Decision: skills' `skill_versions` snapshots ONLY `body`, deliberately narrower than agents' "any config field" rule

**Found:** 2026-08-03 · **Applies to:** src/modules/skills/repository.ts, src/modules/skills/helpers.ts

`AgentsRepository.update` bumps `agent_versions` on any config field change
(`isConfigChange`); `SkillsRepository.update` bumps `skill_versions` ONLY on a
`body` change (`isBodyChange`). This is not an oversight to reconcile — a
skill's entire prompt-visible payload is `body`, so renaming/retyping/enabling
a skill doesn't change what any past review's prompt actually contained. If a
future refactor tries to unify the two version-bump rules "for consistency,"
that would start bumping skill versions on cosmetic edits and break the
version history's meaning as "what did the prompt actually see."

## Trap: `@devdigest/shared` is vendored TWICE, with no sync script — every contract change is a two-file edit

**Found:** 2026-08-04 · **Applies to:** src/vendor/shared/, ../client/src/vendor/shared/

`server/tsconfig.json` maps `@devdigest/shared` → `server/src/vendor/shared`,
and `client/tsconfig.json` maps the SAME specifier → `client/src/vendor/shared`.
They are independent copies and there is no script in `scripts/` that syncs
them; they have already drifted in comment text. Adding or changing a Zod
contract in only one copy type-checks cleanly in that package and fails in the
other — or, worse, silently lets the two ends of one HTTP call disagree about
a field. Always apply a contract edit to BOTH files, and diff them when a DTO
mismatch looks impossible.

## Trap: `GitClient.readFile` throws on a missing file, but `MockGitClient.readFile` returns `''`

**Found:** 2026-08-04 · **Applies to:** src/adapters/git/simple-git.ts, src/adapters/mocks.ts

`SimpleGitClient.readFile` is a bare `fs.readFile`, so a missing path rejects;
`MockGitClient.readFile` returns `''` for any path not in its `files` map. Code
that samples repo files therefore sees two different failure shapes depending
on the adapter, and a test can pass against the mock while the real client
throws. Any read path must both catch the rejection AND treat empty content as
"absent" — `modules/conventions/service.ts#readFileSafe` does both, and the
evidence verifier drops empty-content files for the same reason.

## Trap: `PromptCache`'s default `now: () => 0` makes the cache permanent, not TTL'd

**Found:** 2026-08-06 · **Applies to:** src/platform/model-router.ts, src/modules/reviews/link-cache.ts

`PromptCache`'s constructor is `(ttlMs = 5*60*1000, now: () => number = () => 0)`.
With the default `now`, every entry's `expires` is computed as `0 + ttlMs`, and
the expiry check `hit.expires <= this.now()` becomes `ttlMs <= 0` — always
false for a positive TTL, so nothing ever expires. A caller that constructs
`new PromptCache(ttl)` (one argument) silently gets a cache that never evicts,
which reads as "a TTL cache" in review but behaves as a permanent one in
production. `modules/reviews/link-cache.ts` is the one place allowed to build
a `PromptCache` for external-link fetches, and it always passes `Date.now`
explicitly (`new PromptCache(LINK_CACHE_TTL_MS, Date.now)`) so the trap cannot
be reintroduced at a call site. Any future `PromptCache` construction must do
the same — the two-argument form is the only correct one.

## Decision: undici's `connect.lookup` hook forwards straight into `net`/`tls`, which requires the callback shape to match `opts.all`

**Found:** 2026-08-06 · **Applies to:** src/adapters/http/safe-fetch.ts

`Agent({ connect: { lookup } })` is undici's documented DNS-rebinding
mitigation (the hook runs at actual connect time, closing the check-then-fetch
TOCTOU window), but the public docs do not spell out WHO calls it or how.
Empirically: undici's connector (`node_modules/undici/lib/core/connect.js`)
spreads its options straight into Node's own `net.connect`/`tls.connect`,
which then invokes `lookup` with the SAME contract as `dns.lookup` — including
an `opts.all` flag. When `opts.all` is true, the callback must be
`(err, addresses[])` (an array of `{address, family}`); when it is false/unset,
it must be the single-address 3-arg form `(err, address, family)`. A hook that
always calls back in the 3-arg form (as a naive reading of "it's a dns.lookup
replacement" suggests) makes `net`'s internals receive `undefined` where an
address was expected, failing with `TypeError [ERR_INVALID_IP_ADDRESS]:
Invalid IP address: undefined` — a failure that reads like a broken/incompatible
hook, not a shape mismatch, and gives no hint that `opts.all` was the issue.
Verified against a real HTTPS connection (`https://example.com/` and
`https://github.com/`, including a same-host redirect): once the hook honours
`opts.all` (returning the full filtered address list when true, the first
survivor when false), the fetch completes normally and the IP block-list check
still runs on the addresses actually connected to. This is the mechanism that
made Step 4c of `specs/0004-intent-layer.md` work — the spec's open question
about whether the hook "behaves as assumed under connection reuse" is resolved
for the single-request path; connection-pooling reuse across multiple requests
to the same host was not separately exercised.

## Trap: `LocalNoAuthProvider` always resolves the SEEDED default workspace by name, not any workspace row you insert directly

**Found:** 2026-08-06 · **Applies to:** src/adapters/auth/local.ts, test/*.it.test.ts

`currentWorkspace()` looks up `t.workspaces` by `eq(name, DEFAULT_WORKSPACE_NAME)`
('default') and throws `'No default workspace found — run pnpm db:seed.'` if
missing — it does NOT return "the first workspace" or anything based on the
request. An `*.it.test.ts` that skips `seed()` and inserts its own `workspaces`
row directly builds a fixture `buildApp()` can never reach: every request
resolves to a workspace the test never created, so a "PR in another workspace
→ 404" case that inserts one custom workspace against a bare DB actually
returns 404 for EVERY pull id, including the one meant to succeed — a false
green if the "happy path" assertion is weak. The fix used by
`conventions.it.test.ts` and now `smart-diff.it.test.ts`: always call
`await seed(db)` first, read back the seeded repo/workspace id via
`eq(t.repos.fullName, 'acme/payments-api')`, and hang every fixture PR off
THAT workspace; a genuine second workspace (for a foreign-PR 404 test) is an
ADDITIONAL row inserted after seeding, never a replacement for it.

## Decision: `@modelcontextprotocol/sdk@1.30.0`'s `registerTool` takes a zod-3/zod-4 RAW SHAPE, not `z.object(...)` and not JSON Schema

**Found:** 2026-08-12 · **Applies to:** src/mcp/**, src/mcp-server.ts, package.json

`specs/0006-mcp-server.md` was written without the package installed and
guessed at three possible SDKs (`@modelcontextprotocol/server@2` on zod 4,
maintenance-only `sdk@1.30` on zod 3, or a raw-JSON-Schema fallback). The
empirical check (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`
+ a live `InMemoryTransport` round-trip) showed `sdk@1.30.0` is current, not
maintenance-only, and its `McpServer.registerTool(name, config, handler)`
takes `config.inputSchema`/`config.outputSchema` as `ZodRawShapeCompat` =
`Record<string, ZodType>` — a plain object of field schemas like
`{ repo: z.string(), pr: z.number() }` — NOT a `z.object({...})` instance and
not hand-rolled JSON Schema. Its `zod-compat.d.ts` imports both `zod/v3` and
`zod/v4/core` and dispatches on `~standard` (Standard Schema), so zod 3.25+
(already the installed version here, dedup'd with `fastify-type-provider-zod`
and `openai`) works with zero added copies — `pnpm ls zod --depth=2` shows one
`zod@3.25.76` shared by all three consumers. Passing input validation failures
(unknown tool, wrong arg type) never throws past `client.callTool` — the SDK
itself catches them and returns `isError:true` with an `MCP error -32602: ...`
text, confirming custom `isError:true` wrapping (this module's `toolError`)
composes cleanly with the SDK's own error path rather than conflicting with it.
Any future MCP work in this repo should re-verify the installed SDK's `.d.ts`
before writing schemas — do not assume a specific `@modelcontextprotocol/*`
package shape from documentation or memory, since the SDK's major/minor moves
fast and monolithic-vs-split packaging has changed more than once.

## Trap: `CallToolResult.structuredContent` requires an index-signature type — a concrete DTO interface needs an explicit cast

**Found:** 2026-08-12 · **Applies to:** src/mcp/tools/*.ts

`@modelcontextprotocol/sdk`'s `CallToolResult` types `structuredContent` as
`{ [x: string]: unknown; ... }` (an index signature), but this module's
response DTOs (`RunAgentResult`, `GetConventionsResult`, etc.) are plain
`interface`s without one. Returning `{ structuredContent: result, content }`
where `result` is a concrete DTO fails with `TS2719: Two different types with
this name exist, but they are unrelated` — a confusing message that does not
mention "index signature" at all, because TypeScript is comparing two
structurally-close-but-incompatible `Promise<CallToolResult>` return types
across the `ToolCallback` overload, not the object literal directly. The fix
is a single explicit cast at one chokepoint (`withStructuredContent()` in
`src/mcp/tools/types.ts`, `result as Record<string, unknown>`), not scattering
`as Record<string, unknown>` across every tool wrapper.

## Trap: an unanticipated throw in an MCP tool reaches the model as `isError:true` with an EMPTY text

**Found:** 2026-08-12 · **Applies to:** src/mcp/server-factory.ts

`@modelcontextprotocol/sdk@1.30.0` catches anything a tool handler throws and
returns a well-formed `isError: true` `CallToolResult` — but the text content
is an empty string. The tool "fails safe" at the protocol level while silently
violating the one rule that makes tool errors useful: the model gets a failure
carrying no next step, no cause, and nothing to retry against. Typed errors the
wrapper maps itself (`RepoFormatError` → `toolError(...)`) are unaffected; this
only bites on the paths nobody anticipated — and those are exactly the ones a
human will not be watching.

Found by probing a live stdio server with Docker stopped: `list_agents`
returned `{content:[{type:'text',text:''}],isError:true}`. Unit tests did not
catch it because they inject mock repositories that never fail this way.

Two compounding details:

1. A failed `postgres` connection throws an `Error` whose `.message` is an
   **empty string** — the identifying information is in `.code`
   (`ECONNREFUSED`) and `.name` (`AggregateError`). Interpolating `err.message`
   into an error text yields `"... request: . Check that ..."`.
2. The fix belongs at the registration chokepoint (a `guarded()` wrapper around
   every handler in `server-factory.ts`), not in each tool wrapper — five
   copies of a catch block is five chances to forget one.

Any tool handler added later is covered automatically by `guarded()`. If a
future refactor registers a tool by calling `server.registerTool` directly,
that tool loses this safety net.
