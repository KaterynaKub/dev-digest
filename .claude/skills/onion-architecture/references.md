# References

Sources behind this skill, grouped by what they justify.

## Foundational

- [The Onion Architecture : part 1 — Jeffrey Palermo (2008)](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
  The original. Source of the dependency rule ("all code can depend on layers
  more central, but code cannot depend on layers further out") and of the claim
  that the database is external, not central. Also the argument this skill leans
  on for *why*: data-access techniques churn on a vendor rhythm, and coupled
  applications get dragged into legacy status with them.
- [Onion Architecture — Herberto Graça](https://herbertograca.com/2017/09/21/onion-architecture/)
  Places Onion relative to Ports & Adapters and Clean Architecture. Two points
  used directly: any outer layer may call any inner layer (no pass-through
  proxies needed), and repository *interfaces* belong to the application layer
  rather than the domain — which is why DevDigest's ports live in
  `vendor/shared/adapters.ts` beside the contracts, not inside them.
- [Onion Architecture — The Software Architecture Chronicles (Medium mirror)](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85)

## Node.js / TypeScript application

- [Implementing SOLID and the onion architecture in Node.js with TypeScript — Wolk Software](http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs)
  Onion in a TS codebase with DI. DevDigest deliberately uses a hand-rolled
  composition root instead of InversifyJS — no decorators, no reflect-metadata,
  and the wiring stays greppable.
- [Clean architecture with TypeScript: DDD, Onion — André Bazaglia](https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/)
- [Onion Architecture in Node.js with TypeScript — Sankhadip Samanta](https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391)
- [onion-architecture-boilerplate — Melzar (GitHub)](https://github.com/Melzar/onion-architecture-boilerplate)
  Reference folder layout for an Express/TS onion.
- [Onion Architecture in AWS Lambdas with TypeScript: tradeoffs — DEV](https://dev.to/cheru94/onion-architecture-in-aws-lambdas-with-typescript-a-practical-guide-with-tradeoffs-29h3)
  Useful counterweight on when the ceremony does not pay off.

## Persistence, repositories, and the row/domain split

- [Having the domain model separate from the persistence model — Vladimir Khorikov](https://enterprisecraftsmanship.com/posts/having-the-domain-model-separate-from-the-persistence-model/)
  The core argument in [rules/persistence.md](rules/persistence.md): domain
  objects carry behaviour, persistence models are data structures for storage,
  and conflating them couples the API contract to the schema.
- [Implementing DTOs, Mappers & the Repository Pattern — Khalil Stemmler](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/)
  Row → DTO mapping in TypeScript; the shape `toAgentDto` / `toRepoDto` follows.
- [The repository design pattern — Arnaud Langlade](https://www.arnaudlanglade.com/repository-design-pattern/)
  Why repository methods should read as domain operations rather than exposing a
  query builder.
- [Designing the infrastructure persistence layer — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design)
  Repository-per-aggregate and the rule that one transaction spans one
  aggregate — the basis for "transactions stay inside the repository".
- [Drizzle ORM Best Practices — Paul Serban](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
  Drizzle-specific: exposing database types to API layers is the most common and
  consequential mistake; repositories should return domain types.
- [Repository Pattern in Nest.js with Drizzle ORM — vimulatus](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
- [You might not need… the repository pattern — Jay Freestone](https://www.jayfreestone.com/writing/you-might-not-need-the-repository-pattern/)
  The dissent, cited honestly in [rules/persistence.md](rules/persistence.md).
  DevDigest keeps the pattern for two specific reasons — `workspace_id`
  enforcement and the hermetic/integration test split — not by default.

## Automated enforcement

- [dependency-cruiser rules reference — sverweij (GitHub)](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  Authoritative syntax for `forbidden` rules, `path`/`pathNot` regexes, group
  matching with `$1`, `dependencyTypes`, and the `options` block
  (`tsPreCompilationDeps`, `tsConfig`, `doNotFollow`). All config in
  [rules/enforcement.md](rules/enforcement.md) follows this.
- [How We Enforce Architecture Boundaries at Scale — lastminute.com](https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/)
- [Dependency Cruiser: Restrict Imports in JavaScript — Atomic Object](https://spin.atomicobject.com/dependency-cruiser-imports/)
- [Avoid Cross Module Dependencies with Dependency Cruiser — Jakub Andrzejewski](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b)
  Source of the sibling-module rule shape (`from` captures the module name,
  `pathNot` excludes the module's own folder).
- [How to maintain clean architecture with dependency rules — cubic.dev](https://www.cubic.dev/blog/how-to-maintain-clean-architecture-with-dependency-rules-in-your-codebase)
  Violations block merging, treated the same as failing tests — the CI stance in
  [rules/enforcement.md](rules/enforcement.md).
- [Validate Dependencies According to Clean Architecture — Ken Miyashita](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c)

## Domain model design

- [Anemic domain model — Wikipedia](https://en.wikipedia.org/wiki/Anemic_domain_model)
- [Refactoring from an Anemic Domain Model to a Rich Domain Model — Milan Jovanović](https://milanjovanovic.tech/blog/refactoring-from-an-anemic-domain-model-to-a-rich-domain-model)
- [Anaemic Domain Model vs. Rich Domain Model — Ensono](https://www.ensono.com/insights-and-news/expert-opinions/anaemic-domain-model-vs-rich-domain-model/)

  DevDigest's contracts are deliberately **anemic** — Zod schemas plus inferred
  types, shared verbatim with the client, with behaviour in `reviewer-core` and
  `helpers.ts`. That is a fair trade for a codebase whose complex logic is
  pipeline-shaped (diff → prompt → findings) rather than entity-shaped, and
  whose contracts must serialize across the wire. Revisit only if entity
  invariants start scattering across services.

## Related skills in this repo

- `fastify-best-practices` — the HTTP layer's mechanics
- `drizzle-orm-patterns`, `postgresql-table-design` — the persistence layer's mechanics
- `zod` — contract authoring
- `typescript-expert` — `import type`, project references, path aliases
- `ui-frontend-architecture` — the client-side counterpart to this skill
