# Persistence — repositories, Drizzle, and the row/domain split

Layer 5. The repository is the port implementation for storage: it owns **all**
SQL and hands back **domain** types. The database is external, not the centre
([Palermo](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)).

## Two models, deliberately different

| | Domain model | Persistence model |
|---|---|---|
| Lives in | `vendor/shared/contracts/**` | `db/schema/**`, `db/rows.ts` |
| Shaped by | the business + the client | Postgres and Drizzle |
| Naming | `camelCase` | `snake_case` columns |
| Shared with | the client | nobody outside the repository |

They drift on purpose: the DB has `created_at`, soft-delete flags, denormalised
counters, and FK ids that no API consumer should see. Keeping one type for both
couples your HTTP contract to your schema — the single most consequential mistake
in ORM-backed layering
([Khorikov](https://enterprisecraftsmanship.com/posts/having-the-domain-model-separate-from-the-persistence-model/)).

## The rule

**A Drizzle row must not escape `repository.ts`.** Map it at the boundary.

```ts
// ✅ repository.ts returns a domain type
import { eq, and } from 'drizzle-orm';
import { agents } from '../../db/schema.js';
import type { Agent } from '@devdigest/shared';
import { toAgentDto } from './helpers.js';

export class AgentsRepository {
  constructor(private readonly db: Db) {}

  async getById(workspaceId: string, id: string): Promise<Agent | undefined> {
    const [row] = await this.db.select().from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, id)))
      .limit(1);
    return row ? toAgentDto(row) : undefined;
  }
}
```

Mapping lives in `helpers.ts` (layer 2, pure, unit-testable with a literal).

Where an existing repository still returns rows and the service maps them, the
mapping is at least still inside the module — but new code maps in the
repository, so the row type never appears in a layer-4 signature.

## Rules

### 1. All SQL lives here

No `drizzle-orm` import outside `repository.ts`, `db/**`, and migrations. If a
service needs a new query, add a method — do not hand it a query builder.

### 2. Methods are domain operations

Name them after what the application means, not after SQL:

```ts
// ✅
findStaleRuns(cutoff: Date): Promise<Run[]>
updateClonePath(repoId: string, path: string): Promise<void>
// ❌
selectWhere(cond: SQL): Promise<Row[]>
rawQuery(sql: string): Promise<unknown>
```

A repository that exposes a query builder is not a port — it is Drizzle wearing a
hat, and every caller becomes coupled to the schema.

### 3. `workspace_id` is not optional

Every domain table carries it, and every read/write filters on it. Take
`workspaceId` as the first parameter; never default it, never infer it inside
the repository.

```ts
async list(workspaceId: string): Promise<Agent[]>          // ✅
async list(workspaceId?: string): Promise<Agent[]>          // ❌ tenant leak
```

### 4. Transactions are the repository's business

A use case spanning several writes exposes **one** repository method that opens
the transaction. Do not pass a `tx` handle up to the service — that is a Drizzle
type crossing into layer 4.

```ts
// ✅ repository.ts
async createWithVersion(input: NewAgent): Promise<Agent> {
  return this.db.transaction(async (tx) => {
    const [row] = await tx.insert(agents).values(input).returning();
    await tx.insert(agentVersions).values(snapshot(row));
    return toAgentDto(row);
  });
}

// ❌ service.ts orchestrating a transaction
await this.db.transaction(async (tx) => { … });
```

When two repositories must share one transaction, that is a signal the two
tables belong to one aggregate — put both writes in one repository.

### 5. Repositories do not call adapters or services

A repository talks to the database and nothing else. No HTTP, no git, no LLM. If
persisting needs enrichment, the service fetches it and passes it in.

### 6. Shared repositories are constructed at the root

`AgentsRepository` and `ReviewRepository` are used by several modules, so the
Container owns them (`container.agentsRepo`, `container.reviewRepo`) and injects
them. Do not reach into another module's folder to `new` one up.

### 7. Migrations are explicit

Migrations never run on boot. Generate with `pnpm db:generate`, apply with
`cd server && pnpm db:migrate`. A schema change is not done until the migration
is committed alongside it.

## Where the schema decisions go

Column types, indexes, constraints, and query shape are the `drizzle-orm-patterns`
and `postgresql-table-design` skills' territory. This skill only governs *where*
that code may live: inside `db/**` and `repository.ts`, and nowhere else.

## Is the repository pattern overkill here?

Sometimes it is — for a pure CRUD table, a repository is a thin passthrough, and
[Freestone](https://www.jayfreestone.com/writing/you-might-not-need-the-repository-pattern/)
makes a fair case against ceremony. DevDigest still keeps it, for two concrete
reasons:

1. **Multi-tenancy.** `workspace_id` filtering must be impossible to forget. A
   repository makes it a parameter of every method.
2. **Testability.** Hermetic tests (`*.test.ts`) must run with no Postgres. The
   repository is the seam that makes that possible; DB-backed tests are the
   separate `*.it.test.ts` suite.

Accept the thin passthrough. It costs a file and buys an enforceable boundary.
