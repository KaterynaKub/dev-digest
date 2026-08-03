# server — `@devdigest/api`

Fastify + Drizzle/Postgres. Owns HTTP, persistence, jobs, adapters, and the
`repo-intel` indexer. Review logic itself lives in `reviewer-core/`.

## Before answering

Search `docs/`, `specs/`, `INSIGHTS.md` first.

## Conventions (not obvious from code)

- Modules are registered statically in `src/modules/index.ts` — never autoloaded.
- Module shape: `routes.ts` (HTTP + zod) → `service.ts` (no SQL) →
  `repository.ts` (no HTTP) → `helpers.ts` (pure) → `constants.ts`.
- Zod contracts from `@devdigest/shared` drive validation AND serialization —
  never hand-roll `Schema.parse(req.body)` in a handler.
- Adapters and repositories are resolved in `src/platform/container.ts`, then
  handed to a service as an explicit `<Name>Deps` object built in `routes.ts`.
  A service never imports the `Container`, an adapter, or `db/**` — that is what
  makes mock injection work and is enforced by `pnpm arch:check`.
- Async, secret-dependent ports are injected as resolver functions
  (`llm: (provider) => container.llm(provider)`), so a missing key fails the one
  request that needs it rather than app startup.
- Every domain table carries `workspace_id`; resolve it via `getContext()`.

## Use when

- API map, DI flow, env vars, review context → read `README.md`
- Indexer internals → read `src/modules/repo-intel/README.md`
- Deep-dives → read `docs/` · design specs → read `specs/` ·
  traps and surprises → read `INSIGHTS.md`
- Working inside a module → read `src/modules/<name>/CLAUDE.md`
