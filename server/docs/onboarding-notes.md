# Onboarding notes — non-obvious server facts

Written during a first pass over the codebase. These are the things that read as
bugs or dead code but are neither, plus one real trap. Kept in `docs/` because
they came from onboarding, not from working an issue — genuine findings made
while solving a problem belong in `../INSIGHTS.md`.

## `@devdigest/shared` is duplicated and the copies have drifted

The contracts are vendored twice: `server/src/vendor/shared/` and
`client/src/vendor/shared/`. Both are imported as `@devdigest/shared` via
tsconfig aliases, so the import looks identical while resolving elsewhere.

They are not in sync. `diff -r` reports five differing files, semantically:
the server has `'openrouter'` in the `LLMProvider.id` union, plus `sessionId`,
`CommitFile`, and `CommitFilesPayload`; the client has none of these.

There is no sync script and no CI check. Each side type-checks against its own
copy, so drift produces no error — it surfaces at runtime as a payload failing
validation against a schema the other side never had. `reviewer-core` aliases
the **server** copy, so engine and API agree while the client lags.

Treat the server copy as canonical. Apply contract changes to both trees in one
commit and verify with
`diff -r server/src/vendor/shared client/src/vendor/shared`.

## Three files in `src/platform/` have zero callers

`model-router.ts`, `prompts.ts`, and `trace-builder.ts` are scaffolding for later
course lessons. `model-router.ts` even hardcodes model names nothing reads. Do
not treat them as a source of truth and do not wire them in "because they exist".

`jobs.ts` and `sse.ts` also look uncalled by grep — they are not. They are
instantiated inside `Container` rather than imported by modules.

## `src/platform/{grounding,prompt,structured}.ts` are stale duplicates

The live implementations are in `reviewer-core/src/`; `reviewPullRequest` calls
those. The server copies are historical. Edit the engine's versions.

## `modules/reviews/` has both `repository.ts` and a `repository/` directory

Easy to import the wrong one. Verify the path when touching persistence there.

## The DB schema contains every table, including empty ones

`skills`, `eval`, `ci`, `memory`, `conventions`, `installedPlugins`, `digests`,
`multiAgentRuns` and others are declared from day one and filled by later
lessons. An empty table here is not dead code — do not "clean it up".

## Stale-run reaping on boot assumes ONE API instance per DB

`buildApp()` marks every `running` agent_run as orphaned before accepting
requests. With multiple replicas this would reap another instance's live runs.
Documented in `src/app.ts`; revisit before any multi-replica deployment.

## Comment markers `T1.3`, `T3`, `A6`, `F1`, `A2` reference nothing

Artifacts of the starter's build process. No document defines them; ignore them.
