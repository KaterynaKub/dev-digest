---
name: onion-architecture
description: "Enforces Onion Architecture across the DevDigest backend packages (server/, reviewer-core/). Use when adding or changing anything under server/src/modules/**, server/src/adapters/**, server/src/platform/**, server/src/db/**, or reviewer-core/src/** — including creating a module, writing a service, adding a repository, introducing an adapter or port, wiring the DI container, or reviewing backend imports. Answers 'which layer does this belong to and what may it import'. Covers the dependency rule, ports & adapters, explicit port injection over the Container god-object, persistence-model isolation with Drizzle, the Zod HTTP boundary with Fastify, and automated enforcement via dependency-cruiser. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, dependency rule, layering, layer violation, service.ts, repository.ts, container.ts, adapters, composition root, domain purity, arch:check."
metadata:
  tags: architecture, onion, clean-architecture, hexagonal, ports-and-adapters, backend, fastify, drizzle, dependency-cruiser, typescript
---

# Onion Architecture — DevDigest backend

DevDigest's backend already *is* an onion. This skill makes that explicit,
names the layers, and states the one rule that keeps it from rotting:

> **Dependencies point inward. An inner layer never imports an outer one.**

Coined by [Jeffrey Palermo (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/):
all code may depend on layers more central, but no code may depend on layers
further out. The database is not the centre — it is external.

## When to use

Load this skill when you are:

- creating a new module under `server/src/modules/`
- writing or changing a `service.ts`, `repository.ts`, or `routes.ts`
- adding an adapter (`server/src/adapters/**`) or a port (`@devdigest/shared`)
- wiring anything in `server/src/platform/container.ts`
- touching `reviewer-core/` (the pure core — strictest rules apply)
- reviewing a diff for layering / coupling problems

## The five layers

From the centre outward. **Layer 1 knows nothing about 2–5.**

| # | Layer | Lives in | May import |
|---|-------|----------|------------|
| 1 | **Domain Model** | `server/src/vendor/shared/contracts/**` | `zod` only |
| 2 | **Domain Services** (pure logic) | `reviewer-core/src/**`, `modules/*/helpers.ts` | layer 1, `zod` |
| 3 | **Ports** (interfaces) | `server/src/vendor/shared/adapters.ts` | layers 1–2 |
| 4 | **Application Services** (use cases) | `modules/*/service.ts`, `run-executor.ts` | layers 1–3, own `repository.ts`, `platform/errors` |
| 5 | **Infrastructure** | `adapters/**`, `modules/*/repository.ts`, `modules/*/routes.ts`, `db/**` | anything |

**Composition Root** — `platform/container.ts` + `modules/index.ts`. The one
place allowed to import concrete implementations and wire them together. It sits
outside the rule because its entire job is to violate nothing while knowing
everything.

```
        ┌───────────────────────── 5. Infrastructure ─────────────────────────┐
        │  adapters/**   repository.ts   routes.ts   db/**   (Fastify, Drizzle)│
        │   ┌───────────────────── 4. Application Services ─────────────────┐  │
        │   │            modules/*/service.ts   run-executor.ts            │  │
        │   │   ┌──────────────────── 3. Ports ────────────────────────┐   │  │
        │   │   │  LLMProvider  GitClient  GitHubClient  CodeIndex …   │   │  │
        │   │   │   ┌────────── 2. Domain Services (pure) ─────────┐   │   │  │
        │   │   │   │        reviewer-core/**   helpers.ts         │   │   │  │
        │   │   │   │   ┌───────── 1. Domain Model ────────────┐   │   │   │  │
        │   │   │   │   │   contracts/** (Zod)  — zod only     │   │   │   │  │
        │   │   │   │   └──────────────────────────────────────┘   │   │   │  │
        │   │   │   └──────────────────────────────────────────────┘   │   │  │
        │   │   └──────────────────────────────────────────────────────┘   │  │
        │   └──────────────────────────────────────────────────────────────┘  │
        └─────────────────────────────────────────────────────────────────────┘
                        dependencies point ────────►  inward only
```

## The five hard rules

1. **No inward-pointing import may be outward.** `reviewer-core` never imports
   `drizzle-orm`, `fastify`, `fs`, or anything from `server/src/adapters/`.
2. **Services take ports, not the Container.** A `service.ts` constructor lists
   the interfaces it needs. Passing the whole `Container` is a layering
   violation — see [rules/composition-root.md](rules/composition-root.md).
3. **No SQL above the repository.** `service.ts` never imports `drizzle-orm` or
   `db/**`, and never receives a `Db` handle.
4. **No persistence type crosses a layer boundary.** A repository returns a
   domain type, never a Drizzle row — see [rules/persistence.md](rules/persistence.md).
5. **No HTTP below the route.** `service.ts` never sees `FastifyRequest`,
   `reply`, or a status code. It throws typed errors from `platform/errors.ts`.

## Reading order

- **New to the layering?** [rules/layers.md](rules/layers.md) → [rules/dependency-rule.md](rules/dependency-rule.md)
- **Creating a module?** [rules/layers.md](rules/layers.md) → [rules/application-services.md](rules/application-services.md) → [rules/http-boundary.md](rules/http-boundary.md)
- **Adding an external dependency?** [rules/ports-and-adapters.md](rules/ports-and-adapters.md) → [rules/composition-root.md](rules/composition-root.md)
- **Writing a service?** [rules/application-services.md](rules/application-services.md) → [rules/composition-root.md](rules/composition-root.md)
- **Touching the DB?** [rules/persistence.md](rules/persistence.md)
- **Working in reviewer-core?** [rules/domain-purity.md](rules/domain-purity.md)
- **Writing tests?** [rules/testing.md](rules/testing.md)
- **Turning on the guard?** [rules/enforcement.md](rules/enforcement.md)

## All rules

- [rules/layers.md](rules/layers.md) — the five layers, what belongs where
- [rules/dependency-rule.md](rules/dependency-rule.md) — the allowed-import matrix
- [rules/ports-and-adapters.md](rules/ports-and-adapters.md) — adding a port + adapter
- [rules/composition-root.md](rules/composition-root.md) — explicit port injection; the Container
- [rules/application-services.md](rules/application-services.md) — writing `service.ts`
- [rules/persistence.md](rules/persistence.md) — Drizzle, repositories, row→domain mapping
- [rules/http-boundary.md](rules/http-boundary.md) — Fastify + Zod as the outer edge
- [rules/domain-purity.md](rules/domain-purity.md) — `reviewer-core` as the pure core
- [rules/testing.md](rules/testing.md) — testing each layer without infrastructure
- [rules/enforcement.md](rules/enforcement.md) — dependency-cruiser + CI

Worked good/bad pairs from this codebase: [examples.md](examples.md).
Sources and rationale: [references.md](references.md).

## Relationship to the other skills

This skill governs **where code lives and what it may import**. It does not
replace the tool-specific skills — it constrains them:

| Concern | Tool skill | Onion constraint |
|---|---|---|
| Routes, plugins, hooks | `fastify-best-practices` | layer 5 only; never below the route |
| Schema, queries, migrations | `drizzle-orm-patterns` | layer 5 only; never above the repository |
| Contracts, parsing | `zod` | layer 1; the only dependency the domain may have |
| Types, generics | `typescript-expert` | use `import type` across boundaries |
| Frontend module boundaries | `ui-frontend-architecture` | the client-side counterpart |

When a tool skill and this skill disagree about placement, **this skill wins** —
tool docs optimise for the tool, not for the architecture.
