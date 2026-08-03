# The dependency rule

> All code may depend on layers more central. No code may depend on layers
> further out. — [Palermo, 2008](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)

Two consequences that matter in practice:

1. **Any outer layer may call any inner layer directly.** Onion does not require
   pass-through proxies. A route may use a domain type from layer 1 without
   asking the service to re-export it. Skipping *inward* is fine; pointing
   *outward* never is.
2. **Outward needs are expressed as ports.** When layer 4 needs Postgres, it
   does not import Drizzle — it declares an interface that layer 5 implements.
   That is the Dependency Inversion Principle doing the actual work.

## Allowed-import matrix

Read as: a file matching *From* may import the *Allowed* column and must not
import the *Forbidden* column. This table is the source of truth for the
dependency-cruiser config in [enforcement.md](enforcement.md).

| From | Layer | Allowed | Forbidden |
|---|---|---|---|
| `vendor/shared/contracts/**` | 1 | `zod`, sibling contracts | everything else |
| `vendor/shared/adapters.ts` | 3 | `zod`, contracts | concrete adapters, `db/**`, `fastify` |
| `reviewer-core/src/**` | 2 | `@devdigest/shared`, `zod` | `drizzle-orm`, `postgres`, `fastify`, `node:fs`, `server/src/**` |
| `modules/*/helpers.ts` | 2 | `@devdigest/shared`, `zod`, own `constants.ts` | `db/**`, `adapters/**`, `fastify`, `platform/container.js`, own `repository.ts` |
| `modules/*/constants.ts` | 1–2 | `@devdigest/shared` | everything else |
| `modules/*/service.ts` | 4 | `@devdigest/shared`, own `repository.ts`/`helpers.ts`/`constants.ts`, `platform/errors.js`, `platform/jobs.js`, `platform/sse.js`, other modules' `repository.ts` | `drizzle-orm`, `postgres`, `db/**`, `fastify`, `adapters/**`, `platform/container.js` |
| `modules/*/repository.ts` | 5 | `db/**`, `drizzle-orm`, `@devdigest/shared`, own `helpers.ts` | `fastify`, any `service.ts`, `adapters/**` |
| `modules/*/routes.ts` | 5 | `fastify`, `fastify-type-provider-zod`, own `service.ts`, `@devdigest/shared`, `platform/errors.js` | `drizzle-orm`, `db/**`, any `repository.ts`, `adapters/**` |
| `adapters/**` | 5 | its library, `@devdigest/shared`, `platform/**` | any `modules/**`, `db/**` |
| `db/**` | 5 | `drizzle-orm`, `postgres`, `@devdigest/shared` | `modules/**`, `adapters/**`, `fastify` |
| `platform/container.ts` | root | everything | — |
| `platform/*.ts` (others) | 3–5 | `@devdigest/shared`, `db/**` | `modules/*/service.ts`, `modules/*/routes.ts` |

## Cross-module imports

Modules are siblings, not a hierarchy. The rule:

- ✅ import another module's **`repository.ts`** — persistence is shareable, and
  the composition root already does this for `agentsRepo` and `reviewRepo`.
- ✅ import another module's **`constants.ts`** — e.g. `repos/service.ts` uses
  `INDEX_JOB_KIND` from `repo-intel/constants.ts` to enqueue work.
- ✅ depend on another module's **port** (`RepoIntel` in `repo-intel/types.ts`).
- ❌ import another module's **`service.ts`** directly. Two services that need
  each other is a sign the use case belongs in one of them, or behind a port.
- ❌ import another module's **`routes.ts`**. Ever.

When module A must trigger work in module B, prefer **enqueueing a job** over a
direct call — `repos/service.ts` enqueues `INDEX_JOB_KIND` rather than calling
the indexer, which gives the heavy pass its own timeout and retry budget.

## Deciding where a new file goes

```
Does it name a library or wire format (Drizzle, Fastify, Octokit, HTTP)?
  └─ yes → layer 5 (adapters/ · repository.ts · routes.ts · db/)
  └─ no  ↓
Does it perform I/O or orchestrate several ports?
  └─ yes → layer 4 (service.ts · *-executor.ts)
  └─ no  ↓
Is it an interface describing an external capability?
  └─ yes → layer 3 (vendor/shared/adapters.ts)
  └─ no  ↓
Is it a pure function over domain types?
  └─ yes → layer 2 (helpers.ts · reviewer-core/)
  └─ no  → layer 1 (contracts/ — a type or schema)
```

## Common violations and their fixes

| Violation | Why it breaks the rule | Fix |
|---|---|---|
| `service.ts` imports `drizzle-orm` | layer 4 → layer 5 | move the query into `repository.ts` |
| `service.ts` takes `Container` | layer 4 knows the composition root | inject explicit ports ([composition-root.md](composition-root.md)) |
| `service.ts` does `new RepoRepository(db)` | layer 4 constructs layer 5 | inject the repository |
| `routes.ts` queries the DB | skips layer 4 outward-in | add a service method |
| repository returns a Drizzle row | persistence type crosses a boundary | map to a domain type ([persistence.md](persistence.md)) |
| `helpers.ts` reads a file | layer 2 must be pure | move the read to layer 4/5, pass the contents in |
| `reviewer-core` imports from `server/` | inner package → outer package | move the shared piece into `@devdigest/shared` |
| contract imports a Drizzle type | layer 1 → layer 5 | define the type in Zod; map at the repository |

## `import type` across boundaries

A type-only import erases at compile time, so it creates no runtime coupling —
but it still creates *conceptual* coupling and dependency-cruiser still sees it.
Use `import type` whenever you import across a boundary (the codebase already
does: `import type { Container }`, `import type { LLMProvider }`). It does not
license an outward import: a layer-4 file may not `import type` a Drizzle row.
