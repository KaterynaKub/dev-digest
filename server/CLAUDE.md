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
- Adapters are resolved through `src/platform/container.ts`, never imported
  directly by a service — that is what makes mock injection work.
- Every domain table carries `workspace_id`; resolve it via `getContext()`.

## Use when

- API map, DI flow, env vars, review context → read `README.md`
- Indexer internals → read `src/modules/repo-intel/README.md`
- Deep-dives → read `docs/` · design specs → read `specs/` ·
  traps and surprises → read `INSIGHTS.md`
- Working inside a module → read `src/modules/<name>/CLAUDE.md`
