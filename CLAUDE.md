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

## Use when

- Architecture, quick start, troubleshooting → read `README.md`
- Test strategy and CI split → read `TESTING.md`
- Working in a package → read `server/CLAUDE.md` · `client/CLAUDE.md` ·
  `reviewer-core/CLAUDE.md` · `e2e/CLAUDE.md`
- Hit something non-obvious, or finished a task → run the
  `engineering-insights` skill
