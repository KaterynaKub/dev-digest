# Application services — `service.ts`

Layer 4. A service implements **use cases**: it orchestrates ports and domain
logic to accomplish one business operation. It decides *what happens*, never
*how the outside world works*.

## Anatomy

```ts
import type { GitClient, SecretsProvider } from '@devdigest/shared';
import type { RepoRepository } from './repository.js';
import type { JobRunner } from '../../platform/jobs.js';
import { NotFoundError } from '../../platform/errors.js';
import { parseRepoUrl, withGitHubToken, toRepoDto } from './helpers.js';
import { CLONE_JOB_KIND, CLONE_DEPTH, GITHUB_TOKEN_SECRET } from './constants.js';

export class RepoService {
  constructor(
    private readonly repo: RepoRepository,
    private readonly git: GitClient,
    private readonly secrets: SecretsProvider,
    private readonly jobs: JobRunner,
  ) {}

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url } = payload;
    const token = await this.secrets.get(GITHUB_TOKEN_SECRET);
    const cloneUrl = token ? withGitHubToken(url, token) : url;   // pure helper
    const { path } = await this.git.clone({ owner, name }, cloneUrl, {
      depth: CLONE_DEPTH,
    });
    await this.repo.updateClonePath(repoId, path);                // persistence
  }
}
```

Note what is absent: no `drizzle-orm`, no `fastify`, no `new` on any adapter, no
`Container`.

## Rules

### 1. No SQL, no `Db`, no Drizzle

All persistence goes through the injected repository. A service must not import
`drizzle-orm`, must not import `db/**`, and must not receive a `Db` handle —
including indirectly via `container.db`.

```ts
// ❌ reaches the DB handle and builds its own repository
constructor(private container: Container) {
  this.repo = new AgentsRepository(container.db);
}
// ✅ receives the repository already built
export interface AgentsDeps {
  repo: AgentsRepository;
  llm: (provider: Provider) => Promise<LLMProvider>;
}
constructor(private deps: AgentsDeps) {
  this.repo = deps.repo;
}
```

Row types are re-exported by the repository that owns them
(`export type { AgentRow }`), so a service that needs one imports it from
`../agents/repository.js` — never from `db/rows.ts`.

### 2. No HTTP

No `FastifyRequest`, no `reply`, no status codes, no header parsing. Signal
failure by throwing typed errors from `platform/errors.ts`; the route maps them
to HTTP.

```ts
// ❌ service.ts
if (!row) return reply.code(404).send({ error: 'not found' });
// ✅ service.ts
if (!row) throw new NotFoundError(`Repo ${id} not found`);
```

### 3. Take ports, not the Container

See [composition-root.md](composition-root.md). The constructor is the honest
list of what this use case depends on.

### 4. Push pure logic into `helpers.ts`

If a block has no `await` and no injected dependency, it is layer-2 logic. Move
it to `helpers.ts` and unit-test it with no mocks. `parseRepoUrl`,
`withGitHubToken`, `toAgentDto` are the pattern.

A service that is *only* orchestration is the goal. `modules/reviews/service.ts`
is deliberately thin — the weight sits in `run-executor.ts`.

### 5. Return domain types

Services return layer-1 contract types, never Drizzle rows. Map at the boundary
with a `toXDto` helper. See [persistence.md](persistence.md).

### 6. Resolve the workspace, do not trust the caller

Every domain table carries `workspace_id`. Services take `workspaceId` as an
explicit parameter, resolved by the route from `getContext()` — never read
ambient request state inside a service.

```ts
async list(workspaceId: string): Promise<Agent[]> {
  const rows = await this.repo.list(workspaceId);
  return rows.map(toAgentDto);
}
```

### 7. Cross-module work goes through jobs or ports

To trigger another module, enqueue a job (`this.jobs.enqueue(INDEX_JOB_KIND, …)`)
or call an injected facade port (`RepoIntel`). Never import another module's
`service.ts`.

Failure to enqueue follow-up work must not fail the primary operation — the
clone job's index-enqueue is best-effort, and the user retries via
`POST /repos/:id/resync`.

### 8. Background work returns ids, not results

Long operations are jobs. The service enqueues and returns a run id; the route
does not await execution. Progress reaches the client over SSE through the
injected `RunBus`.

## Executors

When a use case is heavy enough to need its own file (`run-executor.ts`), it is
still layer 4 and all the same rules apply. It is not `platform/` material —
`platform/` holds cross-cutting mechanics (jobs, SSE, errors, config, tracing),
not feature logic.

## Degradation is a service decision

Best-effort enrichment belongs here, not in the adapter. `reviews` treats
repo-intel enrichment as optional: a failure degrades to a missing prompt
section, never a failed run. The adapter throws honestly; the service decides
that the failure is survivable.

```ts
let intel: RepoIntelContext | undefined;
try {
  intel = await this.repoIntel.forPullRequest(repoId, prNumber);
} catch {
  intel = undefined;   // degrade — the prompt simply omits that section
}
```

## Checklist before committing a `service.ts`

- [ ] Constructor lists concrete ports; no `Container`, no `Db`.
- [ ] No import of `drizzle-orm`, `postgres`, `db/**`, `fastify`, `adapters/**`.
- [ ] No `new` on a repository or adapter.
- [ ] Throws `platform/errors.ts` types; no status codes.
- [ ] Returns contract types, not rows.
- [ ] Pure blocks extracted to `helpers.ts`.
- [ ] `workspaceId` is an explicit parameter.
- [ ] Testable with hand-written fakes and no database.
