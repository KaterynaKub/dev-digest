# modules/workspace

Read-only overview: `GET /workspace` returns workspace id, `cloneDir`, and a
per-repo summary. `routes.ts` is the whole module.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Read-only by design — cleanup and re-pull belong to the `repos` module.
- Response keys are snake_case while Drizzle columns are camelCase; keep the
  mapping explicit.
- `cloned` is derived from `clonePath`, so a checkout deleted from disk still
  reports `cloned: true`.

## Use when

- Repo lifecycle actions → read `../repos/CLAUDE.md`
