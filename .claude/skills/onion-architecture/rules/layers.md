# Layers — what belongs where

Five layers, centre outward. Each section states what lives there, what it may
import, and the test that proves it is in the right layer.

## 1. Domain Model — `server/src/vendor/shared/contracts/**`

The vocabulary of DevDigest: `Agent`, `Review`, `Finding`, `PrMeta`, `Trace`.
Zod schemas plus their inferred types.

**May import:** `zod`, and other contracts.
**Must not import:** anything else. No `drizzle-orm`, no `fastify`, no adapters,
no `node:*`.

**Placement test:** could this type survive if we swapped Postgres for
DynamoDB and Fastify for Express? If no, it is not a domain model.

```ts
// contracts/findings.ts — layer 1
import { z } from 'zod';

export const Finding = z.object({
  severity: z.enum(['info', 'warn', 'error']),
  path: z.string(),
  line: z.number().int(),
  message: z.string(),
});
export type Finding = z.infer<typeof Finding>;
```

Contracts are shared with the client. A contract that only the database cares
about (`snake_case` columns, `created_at` timestamps) is a **persistence model**,
not a domain model — it belongs in `db/rows.ts`. See
[persistence.md](persistence.md).

## 2. Domain Services — `reviewer-core/src/**`, `modules/*/helpers.ts`

Pure business logic. Given the same input, always the same output. No I/O.

- `reviewer-core/` — prompt assembly, citation grounding, scoring, reduce.
  The whole package is layer 2. Its only side effect is a call through an
  injected `LLMProvider` (a layer-3 port).
- `modules/*/helpers.ts` — per-module pure transforms: `toAgentDto`,
  `parseRepoUrl`, `withGitHubToken`.

**May import:** layer 1, `zod`.
**Must not import:** `db/**`, `adapters/**`, `fastify`, `node:fs`,
`platform/container.js`.

**Placement test:** can you unit-test it with no mocks at all? If it needs a
mock, it is layer 4, not layer 2.

## 3. Ports — `server/src/vendor/shared/adapters.ts`

Interfaces describing what the application needs from the outside world, phrased
in domain terms. Already defined: `LLMProvider`, `GitClient`, `GitHubClient`,
`CodeIndex`, `Embedder`, `SecretsProvider`, `AuthProvider`.

Ports belong to the **application**, not to the infrastructure that implements
them. That is what inverts the dependency: `SimpleGitClient` depends on
`GitClient`, never the reverse.

**May import:** layers 1–2.
**Must not import:** any concrete implementation, any library the adapter uses
(no `simple-git` types leaking into `GitClient`).

**Placement test:** could two entirely different libraries implement this
interface without changing it? `OpenAIProvider` and `AnthropicProvider` both
implement `LLMProvider` — that is a real port.

See [ports-and-adapters.md](ports-and-adapters.md) for adding one.

## 4. Application Services — `modules/*/service.ts`, `run-executor.ts`

Use cases. Orchestrate the domain and the ports: fetch, decide, persist, emit.
This is where "add a repo", "run a review", "reap stale runs" live.

**May import:** layers 1–3, its own `repository.ts`, its own `helpers.ts` and
`constants.ts`, `platform/errors.js`, other modules' *repositories* via injection.
**Must not import:** `drizzle-orm`, `db/**`, `fastify`, `adapters/**` (concrete),
`platform/container.js`.

**Placement test:** could you drive this class from a CLI, a cron job, and an
HTTP route without changing it? If it mentions `reply` or a status code, no.

See [application-services.md](application-services.md).

## 5. Infrastructure — `adapters/**`, `repository.ts`, `routes.ts`, `db/**`

Everything that talks to the world, plus everything the world talks to:

- **Driven adapters** (`adapters/**`) — implement layer-3 ports using real
  libraries: `octokit`, `simple-git`, `@vscode/ripgrep`, `@anthropic-ai/sdk`.
- **Repositories** (`modules/*/repository.ts`) — implement persistence with
  Drizzle. Own all SQL.
- **Driving adapters** (`modules/*/routes.ts`) — Fastify + Zod translate HTTP
  into a service call and back.
- **Schema/migrations** (`db/**`) — Drizzle table definitions, row types.

**May import:** anything.

**Placement test:** does it name a third-party library or a wire format? Then it
is layer 5.

## Composition Root — `platform/container.ts`, `modules/index.ts`

Not a layer. The assembly point that constructs concrete implementations and
injects them. It is the *only* file allowed to import both a port and its
implementation. See [composition-root.md](composition-root.md).

## Module file shape

Every module under `server/src/modules/<name>/` follows the same shape, and the
shape *is* the layering:

```
modules/<name>/
├── routes.ts        # 5 — HTTP + Zod. No SQL, no business rules.
├── service.ts       # 4 — use cases. Takes ports. No SQL, no HTTP.
├── repository.ts    # 5 — all SQL. Returns domain types.
├── helpers.ts       # 2 — pure functions. No I/O, no imports outward.
├── constants.ts     # 1/2 — literals, job kinds, secret keys.
└── CLAUDE.md        # module conventions
```

Read top-to-bottom, the arrows point down and inward: `routes → service →
repository`, with `helpers` pulled in from the side by anyone.

When a `service.ts` grows past orchestration, extract an executor
(`run-executor.ts` in `modules/reviews/`) — still layer 4, still port-injected.
Do not extract it into `platform/`; `platform/` is for cross-cutting mechanics
(jobs, SSE, errors, config), not for feature use cases.
