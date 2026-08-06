# DevDigest

Local-first AI pull-request review. Four standalone packages, no workspace:
`server/` (Fastify API, :3001) · `client/` (Next.js studio, :3000) ·
`reviewer-core/` (review engine) · `e2e/` (browser flows).

## Before answering

Read the `CLAUDE.md` of the package you are touching first — each one points at
its own `docs/`, `specs/`, and `INSIGHTS.md`. Treat `INSIGHTS.md` as
high-confidence guidance unless the code proves it stale.

## Conventions (not obvious from code)

- Packages are independent — install, run, and test per package, never from root.
- Migrations do NOT run on boot — `cd server && pnpm db:migrate`.
- DB tests must be named `*.it.test.ts`; anything else lands in the hermetic suite.
- Secrets live in `~/.devdigest/secrets.json`, never in git, the DB, or `AppConfig`.
- `server/clones/` holds third-party checkouts — exclude it from every search.
- `@devdigest/shared` is vendored **twice** — `server/src/vendor/shared/` and
  `client/src/vendor/shared/` — with no sync script. Any contract edit is a
  two-file edit; a one-sided edit type-checks in its own package and silently
  desynchronises the API. `server/` is canonical. Verify before reporting done:
  `diff server/src/vendor/shared/<f> client/src/vendor/shared/<f>`.

## Known state (update when it changes)

Baseline as of 2026-08-06 — distinguish pre-existing breakage from your own
regression, and judge every check by the delta rather than by exit code.

- `server` typecheck: **2 pre-existing errors** — `src/db/migrate.ts:38` and
  `src/db/seed.ts:499` (both `TS2345`, unrelated to feature work).
- `server` `arch:check`: **6 warnings, 0 errors** — inherited debt
  (`repo-intel/service.ts` → astgrep/codeindex, `settings`/`pulls` routes →
  `db/schema.ts`, `agents/helpers.ts ↔ repository.ts` cycle, `repos/helpers.ts`
  → `db/schema.ts`). `arch:check` **exits 0 even with violations** — judge it by
  the summary line `x N dependency violations (E errors, W warnings)`.
- Test counts: `server` 209 hermetic (23 files) · `client` 108 (22 files) ·
  `reviewer-core` 34 (4 files).
- `client` lint: 0 errors, 3 pre-existing warnings.
- No `lint` script in `server/`; no `arch:check` in `client/`.

## Use when

- Architecture, quick start, troubleshooting → read `README.md`
- Test strategy and CI split → read `TESTING.md`
- Working in a package → read `server/CLAUDE.md` · `client/CLAUDE.md` ·
  `reviewer-core/CLAUDE.md` · `e2e/CLAUDE.md`
- Hit something non-obvious, or finished a task → run the
  `engineering-insights` skill
