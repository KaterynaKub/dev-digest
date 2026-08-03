# Routing — changed files → skills

The single source of truth for which skill reviews which file. A file may match
several rows; the resulting skill sets are unioned, never duplicated. A skill
matched by three different files still runs once, over all of them.

## Table

| # | Glob | Domain | Skills |
|---|------|--------|--------|
| 1 | `client/src/app/**`, `client/src/components/**`, `client/**/*.tsx` | UI | `ui-frontend-architecture`, `react-best-practices` |
| 2 | `client/src/app/**/{page,layout,route,loading,error,template,default}.tsx`, `client/next.config.mjs`, `client/src/app/**/route.ts` | Next.js | `next-best-practices` |
| 3 | `client/src/**/*.test.tsx`, `client/src/**/*.test.ts`, `client/src/test/**` | UI tests | `react-testing-library` |
| 4 | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/src/**` | Backend architecture | `onion-architecture` |
| 5 | `server/src/**/*.routes.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/platform/**` | HTTP layer | `fastify-best-practices` |
| 6 | `server/src/db/**`, `**/schema.ts`, `**/*.repository.ts` | Persistence | `drizzle-orm-patterns`, `postgresql-table-design` |
| 7 | `server/src/db/migrations/**`, `**/drizzle/**` | Migrations | `postgresql-table-design`, `drizzle-orm-patterns` |
| 8 | any changed `*.ts`/`*.tsx` whose **diff hunks** contain `z.object`, `z.infer`, `safeParse`, `z.string(` | Validation | `zod` |
| 9 | any changed `*.ts`/`*.tsx` (see gate below) | Language | `typescript-expert` |
| 10 | `server/src/**/*.routes.ts`, `server/src/modules/{settings,workspace,repos}/**`, or diff hunks touching auth, tokens, env, `secrets.json`, user input | Security | `security` |
| 11 | `e2e/**` | E2E | — checklist below |
| 12 | `.github/workflows/**`, `docker-compose.yml`, `scripts/**` | Infra | — checklist below |
| 13 | `**/*.md`, `**/CLAUDE.md`, `docs/**` | Docs | — no skill; check links and stale claims only |

## Noise gates

Two rows fire on almost every diff and would drown the report. Gate them:

- **Row 9 (`typescript-expert`)** — run only when the diff introduces or changes
  types, generics, or an `any`/`as` cast. Skip for pure logic edits inside
  already-typed functions.
- **Row 10 (`security`)** — run only when the change touches an actual trust
  boundary: request input, auth, tokens, secrets, file paths, SQL, or HTML
  rendering. A renamed variable in a route file is not a security event.

If a row's only justification is "the file extension matched", do not run it.

## Package-specific reading

Before reviewing files in a package, read that package's `CLAUDE.md` and
`INSIGHTS.md` — the repo's own instruction says to, and `INSIGHTS.md` is
high-confidence guidance unless the code proves it stale. A finding that
contradicts a documented deliberate trade-off is not a finding.

| Files under | Read first |
|-------------|-----------|
| `server/**` | `server/CLAUDE.md`, `server/INSIGHTS.md` |
| `client/**` | `client/CLAUDE.md`, `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/CLAUDE.md`, `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/CLAUDE.md`, `e2e/INSIGHTS.md` |

## Checklists for domains with no skill

### E2E (`e2e/**`)

- Does the spec assert on user-visible outcomes rather than internal state?
- Are selectors resilient (role/label) rather than tied to DOM structure?
- Does a new flow clean up what it creates?
- Is the spec registered wherever the runner discovers specs?

### Infra (`.github/workflows/**`, `docker-compose.yml`, `scripts/**`)

- Does a workflow change respect the package-per-job split? Packages install and
  test independently — never from the root.
- Do DB-touching jobs run migrations explicitly (`pnpm db:migrate`)? They do not
  run on boot.
- Does the hermetic/integration split still hold — do `*.it.test.ts` files run
  only in the integration job?
- Any secret introduced as a literal instead of a repository secret? → CRITICAL,
  and the guard rule in `SKILL.md` should already have caught it.

## Extending this table

When a new skill lands in `.claude/skills/`, add a row here in the same commit.
A skill absent from this table never runs during self-review — that is the
failure mode to watch for, and it is silent.
