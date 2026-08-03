# Enforcement — dependency-cruiser + CI

A convention nobody checks is a convention that decays. Layering violations must
fail the build exactly like a failing test
([lastminute.com](https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/)).

**`dependency-cruiser@17` is already a dependency of `server/`** — currently used
as a *library* by the `repo-intel` indexer (`src/adapters/depgraph/index.ts`).
Turning on the architectural guard needs no new package, only a config and a
script.

## Setup

Create `server/.dependency-cruiser.cjs`. Two settings matter for this repo:

- `tsConfig` — the rules must resolve the `@devdigest/shared` and
  `@devdigest/reviewer-core` path aliases, or every aliased import is invisible.
- `doNotFollow` / `exclude` — `server/clones/` holds third-party checkouts and
  must be excluded from every scan.

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    tsPreCompilationDeps: true,          // see `import type` too
    tsConfig: { fileName: './tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(src/clones|clones|dist|node_modules)/' },
    reporterOptions: { text: { highlightFocused: true } },
  },
  forbidden: [
    // ---------- structural ----------
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cycles make layering unprovable.',
      from: {},
      to: { circular: true },
    },

    // ---------- layer 1: domain model ----------
    {
      name: 'contracts-are-pure',
      severity: 'error',
      comment: 'Domain model may depend on zod and sibling contracts only.',
      from: { path: '^src/vendor/shared/contracts/' },
      to: {
        pathNot: '^src/vendor/shared/(contracts|index)|^node_modules/zod',
        dependencyTypesNot: ['core'],
      },
    },

    // ---------- layer 3: ports ----------
    {
      name: 'ports-know-no-adapters',
      severity: 'error',
      comment: 'A port must not reference an implementation.',
      from: { path: '^src/vendor/shared/adapters\\.ts$' },
      to: { path: '^src/(adapters|db|modules)/' },
    },

    // ---------- layer 4: application services ----------
    {
      name: 'service-no-sql',
      severity: 'error',
      comment: 'Application layer must not touch persistence. Use the repository.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/db/|^node_modules/(drizzle-orm|postgres)/' },
    },
    {
      name: 'service-no-http',
      severity: 'error',
      comment: 'Application layer must not know about HTTP. Throw platform errors.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^node_modules/(fastify|@fastify)/' },
    },
    {
      name: 'service-no-concrete-adapters',
      severity: 'error',
      comment: 'Inject ports from @devdigest/shared; never import an adapter.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'service-no-container',
      severity: 'error',
      comment: 'Services take explicit ports, not the composition root.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/platform/container\\.ts$' },
    },

    // ---------- layer 5: routes ----------
    {
      name: 'routes-no-persistence',
      severity: 'error',
      comment: 'Routes call services; they never reach the DB.',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^src/db/|^node_modules/(drizzle-orm|postgres)/|^src/modules/[^/]+/repository' },
    },

    // ---------- layer 2: helpers must stay pure ----------
    {
      name: 'helpers-are-pure',
      severity: 'error',
      comment: 'helpers.ts is pure domain logic — no I/O, no outward imports.',
      from: { path: '^src/modules/[^/]+/helpers\\.ts$' },
      to: {
        path: '^src/(db|adapters)/|^src/platform/container\\.ts$|^node_modules/(fastify|drizzle-orm|postgres|octokit|simple-git)/',
      },
    },

    // ---------- cross-module ----------
    {
      name: 'no-cross-module-service',
      severity: 'error',
      comment: 'Modules share repositories, constants and ports — never services.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(service|routes)\\.ts$',
        pathNot: '^src/modules/$1/',
      },
    },

    // ---------- infrastructure ----------
    {
      name: 'adapters-know-no-modules',
      severity: 'error',
      comment:
        'Adapters implement ports; they must not reach into feature logic. ' +
        "A module's constants.ts is exempt — literals carry no behaviour, and " +
        'astgrep/depgraph legitimately share repo-intel tuning constants.',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/[^/]+/constants\\.ts$' },
    },
    {
      name: 'db-knows-no-modules',
      severity: 'error',
      comment: 'Schema is infrastructure; it must not depend on features.',
      from: { path: '^src/db/' },
      to: { path: '^src/modules/|^src/adapters/' },
    },
  ],
};
```

## The `reviewer-core` guard

`reviewer-core/` is a separate package, so it gets its own
`reviewer-core/.dependency-cruiser.cjs` — the strictest config in the repo:

```js
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: './tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment: 'The core has no DB, no HTTP, no filesystem, and no server import.',
      from: { path: '^src/' },
      to: {
        path: '^node_modules/(drizzle-orm|postgres|fastify|@fastify|octokit|simple-git)/|^\\.\\./server/',
      },
    },
    {
      name: 'core-no-node-io',
      severity: 'error',
      comment: 'Side effects arrive through the injected LLMProvider only.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'], path: '^(fs|child_process|net|http|https)$' },
    },
  ],
};
```

## Scripts

Add to `server/package.json` and `reviewer-core/package.json`:

```json
{
  "scripts": {
    "arch:check": "depcruise src --config .dependency-cruiser.cjs",
    "arch:graph": "depcruise src --config .dependency-cruiser.cjs --output-type dot > arch.dot"
  }
}
```

`depcruise` exits non-zero on any `error`-severity violation, so CI needs no
extra glue. Run it beside `typecheck`:

```yaml
- run: pnpm typecheck
- run: pnpm arch:check
- run: pnpm test
```

Packages are independent — run per package, never from the root.

## Measured baseline (2026-08-03)

This config was run against `server/src` as written. Result: **20 violations
across 130 modules / 385 dependencies.** Use it as the migration worklist.

| Rule | Count | Where |
|---|---|---|
| `service-no-container` | 5 | all four services + `run-executor.ts` |
| `no-circular` | 5 | 4 via `container.ts`, 1 in `agents/` |
| `routes-no-persistence` | 4 | `workspace`, `settings`, `pulls`, `polling` → `db/schema.ts` |
| `service-no-sql` | 3 | `reviews/service.ts`, `run-executor.ts` → `db/rows.ts`, `db/schema.ts` |
| `service-no-concrete-adapters` | 2 | `repo-intel/service.ts` → `astgrep`, `codeindex/extract` |
| `helpers-are-pure` | 1 | `repos/helpers.ts` → `db/schema.ts` |

**The finding that matters most:** `service-no-container` and `no-circular` are
the *same defect*. Passing the Container creates genuine import cycles —

```
src/modules/repo-intel/service.ts → src/platform/container.ts → src/modules/repo-intel/service.ts
src/modules/repo-intel/pipeline/full.ts → container.ts → service.ts → full.ts
```

A cycle is not a style opinion: it makes the layering unprovable and the module
graph order-dependent. Migrating to explicit port injection
([composition-root.md](composition-root.md)) removes all four container cycles
at once.

Two violations need a different fix than they first appear:

- **`agents/helpers.ts ↔ agents/repository.ts`** — a cycle through
  `import type { AgentRow }`. The row types already live in `db/rows.ts`;
  importing them from there instead of re-exporting through `repository.ts`
  breaks the cycle with a one-line change.
- **`routes-no-persistence` ×4** — these routes import `db/schema.ts` for table
  types, not to query. Still a violation: the route should name a contract type
  from `@devdigest/shared`, not a Drizzle table.

## Rolling it out on existing code

The `service-no-sql` and `service-no-container` rules will fail today: all four
services take a `Container` and build repositories from `container.db`. Two
honest options:

1. **Migrate first, then turn the rule to `error`.** Preferred — the migration
   is mechanical and per-service ([composition-root.md](composition-root.md)).
2. **Land the rule at `severity: 'warn'`,** migrate service by service, then
   flip to `error` in the same commit as the last fix.

Never add a `known-violations` baseline that outlives the migration. A permanent
exemption list is how the rule quietly stops meaning anything.

## When a rule blocks legitimate work

Fix the code, not the config — that is the default. Change the rule only when
the *architecture* changed, and then:

- change it in one commit, with the reasoning in the commit message,
- update the matrix in [dependency-rule.md](dependency-rule.md) to match,
- never use `severity: 'ignore'` to silence a single file.

The config and the matrix must agree. If they drift, the documentation is
decoration.
