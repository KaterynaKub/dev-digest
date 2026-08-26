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

---

## Trap: `path.relative` on Windows silently emptied the import graph — index still said `full`

**Found:** 2026-08-13 · **Applies to:** src/adapters/depgraph/index.ts

`DepCruiseGraph.toRel()` returned `path.relative(...)` verbatim. That carries
**platform** separators, so on Windows it produced `client\src\app.ts` — while
every path the indexer stores uses forward slashes (`pipeline/walk.ts:119`
already normalises with `.split(sep).join('/')`).

The consequence was a chain of silent degradation, not a crash:

1. `buildEdges` guards each module with `fileSet.has(from)` / `fileSet.has(to)`.
   With backslash keys, **every** check failed → `continue` → `[]` edges.
2. No throw meant `graphFailed` stayed unset, so the pipeline stamped the index
   `status: 'full'` (`pipeline/full.ts:262`) on a completely empty `file_edges`.
3. `resolveReferences` JOINs `file_edges` — with zero edges it resolved zero
   references. Live DB: 6416 references, **0** with `decl_file`.
4. `getResolvedCallers` filters on `decl_file`, so Blast Radius reported
   `38 symbols · 0 callers` on an index that reported itself perfectly healthy.

The `catch { return []; }` in `buildEdges` is documented as degrading a broken
tsconfig to "no edges", which made the empty result look intentional. It was
not — the failure never reached the catch.

Verified end-to-end by reindexing after the fix: `file_edges` 0 → 514,
resolved references 0 → 640, on the same repo at the same `status: 'full'`.

**Testing note:** dependency-cruiser resolves inputs against `process.cwd()`.
A fixture under `os.tmpdir()` (another drive on Windows) makes `cruise` stat a
mangled path like `<cwd>\C:\Users\...` and throw ENOENT, so the adapter is
never exercised. `test/depgraph-paths.test.ts` builds its fixture under the
package directory instead, and asserts `edges.length > 0` — a test that only
checks separators passes vacuously on an empty result, which is precisely the
bug being guarded against.

## Decision: an MCP tool serving a contract must type its port against that contract, not a local re-declaration

**Found:** 2026-08-13 · **Applies to:** src/modules/mcp-tools/service.ts, src/mcp/tools/get-blast-radius.ts

`McpToolsService`'s constraint 2 (no cross-module service imports) is normally
satisfied by re-declaring a structural port — `ReviewRunner` and
`ConventionsReader` both spell out their own shapes. `BlastReader` deliberately
does NOT: it is typed as `forPull(...): Promise<BlastRadius>`, importing the
contract type from `@devdigest/shared`. Constraint 2 forbids importing
`BlastService`, not the contract every layer already speaks — and re-spelling
`BlastRadius` here would create a second definition of the SAME payload that
could drift from the vendored contract with no compiler error, on a surface
whose whole job is to serve it verbatim.

Two related traps this exposed:

- `BlastRadius.reason` is `.nullish()` in the contract, so `buildBlastRadius`
  may legitimately omit the key. The MCP SDK validates a tool's own output
  against its declared `outputSchema`, where an ABSENT key fails `.nullable()`
  while an explicit `null` passes. The wrapper normalises with
  `{ ...result, reason: result.reason ?? null }` — a `nullish()` contract field
  is not automatically safe to forward into an `outputSchema`.
- `index_status`/`degraded`/`reason` must reach the model unflattened, for the
  same reason `blast/CLAUDE.md` protects them on the HTTP side: an empty
  `downstream` means "nothing calls this" on a full index and "unknown" on a
  broken one. Trimming them for brevity would let a model report an unmeasured
  blast radius as a safe one. `test/mcp-tools.test.ts` guards this with a named
  negative test mirroring `blast-helpers.test.ts`'s.

## Tooling: `pnpm test` runs BOTH lanes at once and the integration lane fails under that contention

**Found:** 2026-08-13 · **Applies to:** package.json

`server`'s `test` script is a bare `vitest run`, which collects all 42 files —
hermetic and `*.it.test.ts` together. Run that way, several Testcontainers
suites fail (`Cannot read properties of undefined`, ~6 tests) purely from
concurrency; run on its own, `pnpm exec vitest run .it.test` is green
(15 passed / 44 skipped) on the identical tree. Verified by stashing all local
changes and re-running: the failures reproduce with a clean working tree, so
they are a harness artefact, not a regression.

Judge a change by the two lanes separately, exactly as `TESTING.md` documents
them (`vitest run --exclude '**/*.it.test.ts'` and `vitest run .it.test`), and
do not read a red `pnpm test` as breakage without splitting it first.

## Trap: every blast `file:line` is a coordinate in `last_indexed_sha`, not in the PR head

**Found:** 2026-08-13 · **Applies to:** src/modules/blast, src/modules/repo-intel

`references.line` is recorded when the indexer walks a revision, and
`repo_index_state.last_indexed_sha` names that revision. Nothing re-anchors
those numbers afterwards, so on a repo whose index has fallen behind, a caller
row still reports the line it occupied at index time. Observed live: the index
sat at `66727c85` (June 15) while HEAD was two months newer, and
`reviews/service.ts` had roughly doubled in length — so a `NotFoundError`
caller recorded at line 53 pointed into the middle of a JSDoc block in the
current file, and `enclosingFromRows` (`repo-intel/service.ts:775`, "nearest
symbol at or above the line") labelled it with whatever function preceded that
stale line. Both the number AND the caller name come from the old snapshot;
neither is wrong at the time it was written, and nothing in `index_status`
reveals the gap — the index reported itself `full`, because it IS full, just
for a different commit.

The rule: never resolve a blast coordinate against the PR head. `BlastRadius`
now carries `indexed_sha` (null when there is no index) and a server-computed
`index_stale`, and any deep-link must be pinned to `indexed_sha`. Staleness is
deliberately NOT folded into `degraded`: a stale index is intact and internally
consistent, so conflating the two would either understate a broken index or
overstate a merely old one.

## Trap: a character-class regex path guard accepts `..` as a valid segment — it is not a traversal guard by itself

**Found:** 2026-08-24 · **Applies to:** src/vendor/shared/contracts/platform.ts

A schema meant to reject path traversal (`ContextRoot`, gating AC-47's
containment check) was specified as
`z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/)` — allowed chars
joined by `/`. This looks like it blocks `..` because `..` "isn't a path
separator", but `.` is itself in the allowed character class, so the segment
`..` is just two allowed characters in a row and matches cleanly:
`'../etc'.match(...)` succeeds. Confirmed with a standalone zod check before
trusting the regex. A char-class-only pattern can only ever constrain which
*characters* appear — it cannot forbid a specific *segment value* built
entirely from allowed characters. The fix is a `.refine()` that splits on `/`
and rejects any segment equal to `.` or `..`, in addition to the char-class
check. Any future "safe relative path" Zod schema needs this same two-part
shape (chars + per-segment rejection), not a regex alone — grep for
`\.\.` acceptance with a throwaway test case before trusting a path-shaped
regex as a security boundary.

A related sharpening of the same data: the caller de-duplication key in
`repo-intel/service.ts` is `fromPath|enclosing|toSymbol` with NO line, so
several calls to the same symbol from the same function collapse to whichever
row arrived first. The callers list is therefore "places that call this",
never "all call sites" — do not read a count of 1 as proof of a single call.

---

## Trap: `{ ...new MockXClient(), method: fn }` silently drops every un-overridden method

**Found:** 2026-08-24 · **Applies to:** src/adapters/mocks.ts, any test overriding one mock method

`MockGitClient` (and the other `Mock*` adapters) implement their interface
methods on the class prototype, not as own instance properties. Object spread
(`{ ...instance }`) only copies OWN enumerable properties, so
`{ ...new MockGitClient({ files }), listFiles: vi.fn(...) }` produces an object
with exactly one method (`listFiles`) and nothing else — every other call
(`readFile`, `dirtyPaths`, `writeFile`, …) throws `is not a function` the
moment the code under test reaches it, even though the mock "looks" fully
constructed at the call site. This surfaced writing
`project-context-service.test.ts`: three tests failed with `X is not a
function` from spreading `new MockGitClient()` to override a single method.

Fix: bind every needed method explicitly from the base instance
(`base.readFile.bind(base)`) into a plain object, then apply the override on
top — never spread a class instance when you want "this instance, but one
method replaced". A small `partialGit(base, overrides)` helper that lists every
`GitClient` method once is cheaper than re-deriving this per test file.

---

## Pattern: assert on a route's log output by wrapping `req.log` inside an `onRequest` hook

**Found:** 2026-08-24 · **Applies to:** test/*.it.test.ts, any route whose log call is part of the contract (e.g. NFR-11/NFR-17 "log path, never text")

Fastify/Pino expose no public API to capture what a handler logged — `app.log`
is the parent logger and `req.log` is a per-request Pino child, so spying on
`app.log.info` before the request never sees a call made through `req.log`.
The working approach: register `app.addHook('onRequest', async (req) => {...})`
BEFORE injecting the request, and inside it replace `req.log.info`/`req.log.warn`
in place with a wrapper that records the call args and then forwards to the
original bound method. Because the hook runs first on every request, the
child logger instance is already attached to `req` by the time the wrapper is
installed, and the route handler's later `req.log.info(...)` calls go through
the wrapper. Used in `project-context.it.test.ts` to assert `PUT
.../project-context/doc` logs `{ path, ... }` and never the document's
`content`/`reason` text.

## Trap: `waitForPrRuns` returns silently on timeout — a slow lane looks like a broken feature

`test/helpers/runs.ts`'s `waitForPrRuns` polls `agent_runs` until every row for
the PR is terminal, but on timeout it **returns the rows it has** rather than
throwing (`if (Date.now() - start > timeoutMs) return runs;`). Its default
budget is `10_000` ms.

A review run against `MockLLMProvider` takes 5–10 s wall-clock in the
integration lane, so a file with several run-asserting tests exhausts that
default on the later ones. The failure does not look like a timeout: the test
proceeds with an unfinished run, so `trace.prompt_assembly` is `undefined` and
`llm.calls` is empty — which reads exactly like "the feature never called the
model" or "the prompt section was never assembled". Each test passes when run
alone with `-t`, and fails only in the full-file run.

Seen in `project-context-prompt.it.test.ts` (`0001b`): 5 of 7 passing together,
2 failing with `Cannot read properties of undefined (reading 'user')` and
`expected [] to have a length of 1`. Fixed by passing an explicit
`{ expected: 1, timeoutMs: 30_000 }`. `vitest.config.ts` already allows it —
`testTimeout` is `120_000`, so the helper's own default was the only ceiling.

**Rule:** in any integration test that starts a review run, pass an explicit
`timeoutMs` well above the number of runs × ~10 s. If a run-asserting test
fails on a field being `undefined`, re-run it alone with `-t` before believing
the production code is at fault.

## Trap: `arch:check`'s `helpers-are-pure` rule is looser than the convention a module's plan may demand

**Found:** 2026-08-25 · **Applies to:** .dependency-cruiser.cjs, src/modules/*/helpers.ts

`helpers-are-pure` (`.dependency-cruiser.cjs`) only forbids a `helpers.ts` from
importing `^src/(db|adapters)/`, `platform/container.ts`, or a short list of
native node_modules (`fastify`, `drizzle-orm`, `postgres`, `octokit`,
`simple-git`). It says nothing about importing another module's `helpers.ts`,
`reviewer-core`, or anything else pure — all of that passes `arch:check`
clean. A stricter convention ("only `@devdigest/shared` types and
`./constants.js`", as `0002a-pr-brief-server.md` specified for
`modules/brief/helpers.ts`) is a *design* discipline the plan chose, not
something the tool enforces — `arch:check` reporting 0 new violations is not
evidence that a helpers file honoured a narrower per-module rule than the
dependency-cruiser config actually encodes. Concretely, this meant
`buildBriefLineIndex` (a near-duplicate of `reviewer-core#buildLineIndex`) was
re-implemented locally in `brief/helpers.ts` rather than imported — the import
would have passed `arch:check` silently, and only the plan's own stricter
wording caught it. When a plan states a narrower import list than
`helpers-are-pure` actually checks, verify by reading the file's imports
directly; do not trust a clean `arch:check` run as proof.

---

## Trap: `no-circular` fires on a TYPE-ONLY import back into `platform/container.ts`

**Found:** 2026-08-25 · **Applies to:** .dependency-cruiser.cjs, src/platform/container.ts

Adding `import { readContextRoots } from '../modules/settings/feature-models.js'`
to `container.ts` (to satisfy the new `ContextDocReader` port's `contextRoots`
resolver) turned the pre-existing 6-warning baseline into 7: a new
`no-circular: src/modules/settings/feature-models.ts → src/platform/container.ts
→ src/modules/settings/feature-models.ts` warning appeared, even though
`feature-models.ts`'s only reference back to `container.ts` is `import type
{ Container } from '../../platform/container.js'` — a type that is fully
erased at runtime and adds no real dependency. `dependency-cruiser`'s
`no-circular` rule does not distinguish `import type` from a value import when
building the graph; a type-only edge closes the cycle exactly like a value one
does. Any new `container.ts` getter that wants to reuse a helper from a
`modules/*/routes.ts`-adjacent file which itself type-imports `Container`
(the common pattern for `buildXDeps(container: Container)` factories) will hit
this. Fix: reimplement the small piece of logic locally in `container.ts`
using cycle-free imports (`db/schema.ts`, a module's pure `helpers.ts`, and the
`@devdigest/shared` zod schema directly) rather than importing the
`Container`-typed helper — do not assume a `type`-only import is invisible to
`arch:check`.

---

## The `no-circular` container trap is scoped to `container.ts`, not to the module

**Found:** 2026-08-25 · **Applies to:** .dependency-cruiser.cjs, src/platform/container.ts, src/modules/*/routes.ts

Verified empirically during a self-review, by temporarily adding the avoided
import and re-running `arch:check`: importing
`settings/feature-models.js#readContextRoots` **into `container.ts`** takes the
baseline from 6 to 7 warnings (`no-circular: settings/feature-models.ts → …`),
because `feature-models.ts` type-imports `Container` back. But the same import
**in a module's `routes.ts` is completely fine** — `brief/routes.ts` imports
`readContextRoots` and the count stays at 6, because `routes.ts` is not what
closes the loop.

The practical consequence: when a new port needs a `Container`-typed helper,
do not reflexively duplicate the helper's logic into `container.ts`. First ask
whether the resolver can be composed one layer out, in `routes.ts`, where the
import is free — `brief/routes.ts#buildBriefDeps` does exactly this for
`contextRoots` while `container.ts#contextDocReader` duplicates the same parse
for its own construction of `ProjectContextService`. Only the latter genuinely
needed the workaround.

Method worth reusing: to check whether an "this import would break arch:check"
claim is true, inject the import, run `pnpm arch:check`, read the summary line,
then restore the file. It costs one minute and turns a plausible assumption
into a measured fact — the review that recorded this had inherited the claim
unverified from two prior agents.

---

## A numeric cap defined in `constants.ts` is restated in three other places in `docs/specs/`, none of them checked by any tool

**Found:** 2026-08-26 · **Applies to:** src/modules/brief/constants.ts, docs/specs/SPEC-02-pr-why-risk-brief.md

Changing `MAX_BRIEF_DOC_TOKENS` (40_000 → 4_000, to fit under the new
`MAX_BRIEF_INPUT_TOKENS` = 8_000 budget) only compiles-and-tests green; it does
NOT surface the two prose restatements of the same number that already existed
in the spec — AC-16 and NFR-6 both spelled out "40 000 estimated tokens" in
free text, independently of the code and of each other. Nothing greps these on
build; a spec left saying one number while the code enforces another is a
silent, undetectable drift. When a plan or task changes a cap that a spec
already quantifies, `grep` the spec for the OLD literal (with common
formattings: `40_000`, `40 000`, `40,000`) before declaring the edit done —
the traceability table only proves the requirement is tested, never that its
stated value still matches the code.

---

## `drizzle-kit generate` on a composite-PK change over an already-populated table emits an unsafe migration silently

**Found:** 2026-08-26 · **Applies to:** src/db/schema/reviews.ts, src/db/migrations/

Widening `pr_brief`'s PK from `prId` alone to `(prId, headSha, indexedShaKey)`
and running `pnpm db:generate` produced a migration that only ADDs the new
constraint — it does **not** DROP the old one first (drizzle-kit cannot infer
the existing constraint's name, so it leaves a `-- ALTER TABLE ... DROP
CONSTRAINT "<constraint_name>"` comment for a human to fill in and uncomment),
and it does **not** backfill the new PK column before adding it to the key —
the column keeps its bare `DEFAULT ''`, so any row that already has a real
`indexed_sha` gets keyed on `''` instead, silently colliding with any other
`indexed_sha: null` row for the same PR. Applied as generated, this migration
would either fail outright (old PK constraint still present under a name
Postgres now rejects for the new one) or succeed while quietly mis-keying
every pre-existing row.

`generate` is safe to run for the journal/snapshot shape and to see what
Drizzle infers, but treat its SQL as a draft, not the migration, whenever a
table may already hold rows: verify the real constraint name first
(`SELECT conname FROM pg_constraint WHERE conrelid = '<table>'::regclass AND
contype = 'p'`), hand-write the DROP + backfill `UPDATE` + ADD CONSTRAINT
sequence, and only keep the machine-generated `meta/*_snapshot.json` +
`_journal.json` entries (fixing the journal's `tag` to match the hand-written
filename, since `generate` names the tag after ITS OWN discarded file).

---

## `brief.it.test.ts` can only produce a real `indexed_sha: null` row by omitting the PR's `pr_files` rows entirely, not by mocking `repoIntel`

**Found:** 2026-08-26 · **Applies to:** src/modules/brief/brief.it.test.ts, src/modules/blast/service.ts

`BriefService#doGenerate` reads the current index leg of the cache key through
`deps.blastReader.forPull`, which is `BlastService#forPull` wired whole (brief
takes no repository double for it, only the structural `BlastReader` port). That
service's OWN early return — "a PR with zero `pr_files` rows is a fact, not a
data gap" — is the only path that reports `indexed_sha: null` independent of
`stubRepoIntel`'s `IndexState.lastIndexedSha`, which is a non-optional `string`
and always truthy in every existing fixture. Overriding `stubRepoIntel`'s
`indexState` cannot produce `null` short of also mutating `buildBlastRadius`'s
own logic, since `indexed_sha` is `indexState?.lastIndexedSha ? … : null` and
the field's type does not admit `undefined`.

The one way to exercise AC-28's `indexed_sha: null` case end-to-end is to call
`setupRepoAndPr` (or an equivalent) WITHOUT inserting the `pr_files` row for
that PR — `doGenerate` still proceeds normally because `loadDiff` prefers the
mock `GitClient`'s diff over `pr_files` reconstruction, so the two reads are
independent: the generation succeeds, but blast's `getPrFiles` returns `[]`,
taking the early-return path and forcing `indexed_sha: null` regardless of the
index stub. Any future test needing a null-indexed brief should reach for this
same trick rather than trying to coax `stubRepoIntel` into it.
