# Worked examples

Good/bad pairs drawn from this codebase. The ❌ side is real current code where
noted — these are the migration targets, not invented straw men.

## 1. Service construction — the Container god-object

**❌ Current** (`server/src/modules/agents/service.ts:54`):

```ts
export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }
}
```

Three violations in four lines: layer 4 imports the composition root, receives a
`Db` handle, and constructs a layer-5 object.

**✅ Target:**

```ts
import type { LLMProvider, Provider } from '@devdigest/shared';
import type { AgentsRepository } from './repository.js';

export type LlmResolver = (id: Provider) => Promise<LLMProvider>;

export class AgentsService {
  constructor(
    private readonly repo: AgentsRepository,
    private readonly llm: LlmResolver,
  ) {}

  async list(workspaceId: string): Promise<Agent[]> {
    return this.repo.list(workspaceId);   // repository returns domain types
  }
}
```

Wired once, in the composition root:

```ts
// platform/container.ts
get agentsService(): AgentsService {
  return (this._agentsService ??= new AgentsService(
    this.agentsRepo,
    (id) => this.llm(id),
  ));
}
```

## 2. Route construction

**❌ Current** (`server/src/modules/repos/routes.ts:21`):

```ts
const service = new RepoService(app.container);
```

**✅ Target:**

```ts
const service = app.container.repoService;
```

Routes are layer 5, so touching the Container is legal — but resolving keeps all
wiring in one file, so adding a port changes one place instead of five.

## 3. SQL above the repository

**❌**

```ts
// modules/reviews/service.ts
import { eq } from 'drizzle-orm';
import { runs } from '../../db/schema.js';

async listRuns(workspaceId: string) {
  return this.container.db.select().from(runs)
    .where(eq(runs.workspaceId, workspaceId));
}
```

**✅**

```ts
// modules/reviews/service.ts — layer 4
async listRuns(workspaceId: string): Promise<Run[]> {
  return this.repo.listRuns(workspaceId);
}

// modules/reviews/repository.ts — layer 5
async listRuns(workspaceId: string): Promise<Run[]> {
  const rows = await this.db.select().from(runs)
    .where(eq(runs.workspaceId, workspaceId));
  return rows.map(toRunDto);
}
```

## 4. Persistence type escaping

**❌** — the Drizzle row reaches the HTTP response, coupling the API contract to
the schema. Add a column, and clients see it:

```ts
async getById(workspaceId: string, id: string) {
  const [row] = await this.db.select().from(agents).where(…);
  return row;                       // AgentRow — snake_case, internal fields
}
```

**✅** — map at the boundary:

```ts
async getById(workspaceId: string, id: string): Promise<Agent | undefined> {
  const [row] = await this.db.select().from(agents).where(…);
  return row ? toAgentDto(row) : undefined;
}
```

## 5. HTTP leaking into a service

**❌**

```ts
// service.ts
async get(req: FastifyRequest, reply: FastifyReply) {
  const row = await this.repo.getById(req.params.id);
  if (!row) return reply.code(404).send({ error: 'not found' });
  return reply.send(row);
}
```

**✅**

```ts
// service.ts — throws a domain error
async get(workspaceId: string, id: string): Promise<Agent> {
  const agent = await this.repo.getById(workspaceId, id);
  if (!agent) throw new NotFoundError(`Agent ${id} not found`);
  return agent;
}

// routes.ts — maps to HTTP
app.get('/agents/:id', { schema: { response: { 200: Agent } } }, async (req) => {
  const { workspaceId } = await getContext(req);
  return service.get(workspaceId, req.params.id);
});
```

The service is now callable from a job, a CLI, and a route.

## 6. Hand-rolled validation at the edge

**❌** — bypasses the response serializer, so internal fields can leak out:

```ts
app.post('/repos', async (req) => {
  const body = CreateRepoRequest.parse(req.body);
  return service.add(body);
});
```

**✅** — the contract validates *and* serializes:

```ts
app.post('/repos', {
  schema: { body: CreateRepoRequest, response: { 201: Repo } },
}, async (req, reply) => {
  const { workspaceId } = await getContext(req);
  return reply.code(201).send(await service.add(workspaceId, req.body));
});
```

## 7. Impure helper

**❌** — `helpers.ts` is layer 2; this needs a mock to test:

```ts
export async function loadAndFormatDiff(repo: RepoRef, git: GitClient) {
  const diff = await git.diff(repo, 'main', 'HEAD');
  return diff.files.map((f) => `${f.path} +${f.additions}`).join('\n');
}
```

**✅** — split the I/O from the transform:

```ts
// helpers.ts — pure, testable with a literal
export function formatDiffSummary(diff: UnifiedDiff): string {
  return diff.files.map((f) => `${f.path} +${f.additions}`).join('\n');
}

// service.ts — layer 4 does the I/O
const diff = await this.git.diff(repo, base, head);
const summary = formatDiffSummary(diff);
```

## 8. Cross-module coupling

**❌** — importing a sibling's service creates a cycle risk and couples two use
cases:

```ts
// modules/repos/service.ts
import { RepoIntelService } from '../repo-intel/service.js';

await new RepoIntelService(this.container).index(repoId);
```

**✅** — enqueue a job (current, correct behaviour in `repos/service.ts`):

```ts
import { INDEX_JOB_KIND } from '../repo-intel/constants.js';

await this.jobs.enqueue(INDEX_JOB_KIND, { repoId });
```

The heavy pass gets its own timeout and retry budget, and a failure to enqueue
does not fail the clone.

Alternatively, depend on the **facade port** when you need a synchronous answer:

```ts
constructor(private readonly repoIntel: RepoIntel) {}   // interface, not the service
```

## 9. Adding a port — the full loop

```ts
// 1. vendor/shared/adapters.ts — layer 3
export interface Clock { now(): Date; }

// 2. adapters/clock/system.ts — layer 5
import type { Clock } from '@devdigest/shared';
export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

// 3. adapters/index.ts
export { SystemClock } from './clock/system.js';

// 4. platform/container.ts — composition root
export interface ContainerOverrides { clock?: Clock; }
get clock(): Clock {
  if (this.overrides.clock) return this.overrides.clock;
  return (this._clock ??= new SystemClock());
}

// 5. the service takes the port
constructor(private readonly clock: Clock) {}

// 6. the test injects a fake — no mocking library needed
new ReviewService(repo, { now: () => new Date('2026-01-01') });
```

## 10. A test that proves the layering

```ts
// hermetic — no Postgres, no Container, no network
it('degrades to no enrichment when repo-intel fails', async () => {
  const executor = new RunExecutor(
    async () => fakeLlm,
    { forPullRequest: async () => { throw new Error('index cold'); } } as any,
    fakeBus,
  );

  const outcome = await executor.run(input);

  expect(outcome.status).toBe('completed');   // failure degraded, run survived
});
```

If this test needed `testcontainers`, the executor would be reaching through a
layer it should not.
