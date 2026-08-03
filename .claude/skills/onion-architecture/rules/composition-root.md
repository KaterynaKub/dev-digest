# Composition root — inject ports, not the Container

The composition root is the single place that knows both an interface and its
implementation. In DevDigest that is `server/src/platform/container.ts` plus the
static registration in `server/src/modules/index.ts`.

Everything else receives what it needs. Nothing else resolves it.

## The rule

**An application service's constructor lists the ports it uses. It never takes
the `Container`.**

```ts
// ❌ layer 4 depends on the composition root
export class AgentsService {
  private repo: AgentsRepository;
  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);   // and on the DB handle
  }
}

// ✅ layer 4 depends only on what it uses
export class AgentsService {
  constructor(
    private readonly repo: AgentsRepository,
    private readonly llm: (id: Provider) => Promise<LLMProvider>,
  ) {}
}
```

## Why `constructor(container: Container)` is a violation

It looks harmless — the Container is typed, and mock injection already works
through `ContainerOverrides`. Four concrete costs:

1. **It inverts the dependency the wrong way.** `Container` imports
   `OctokitGitHubClient`, `SimpleGitClient`, `RipgrepCodeIndex`, `AnthropicProvider`,
   `postgres`. A service typed against `Container` transitively depends on every
   adapter in the system, including ones it never calls.
2. **It hands out `container.db`.** Once a service can reach the DB handle, the
   "no SQL above the repository" rule is enforced only by discipline, and layer 4
   ends up constructing layer 5 via `new XRepository(container.db)`. Injecting
   the repository itself removes the DB handle from the service entirely.
3. **The signature lies.** `constructor(container: Container)` tells a reader
   nothing. `constructor(repo, git, secrets, jobs)` is an honest dependency list
   and makes an over-hungry class obvious.
4. **Tests over-build.** Testing `AgentsService` should not require a Postgres
   handle, an SSE bus, and a JobRunner. With explicit ports, a test constructs
   the two things the class actually touches.

## What each service actually needs

This is the implemented state — each service declares a `<Name>Deps` interface
next to itself and takes it as its single constructor argument:

| Service | `Deps` members |
|---|---|
| `AgentsService` | `repo`, `llm(provider)` |
| `PollingService` | `repo`, `github()` |
| `WorkspaceService` | `repo`, `cloneDir` |
| `RepoService` | `repo`, `git`, `jobs`, `secrets` |
| `ReviewRunExecutor` | `git`, `runBus`, `repoIntel`, `llm(provider)` |
| `ReviewService` | `ReviewRunDeps` + `repo`, `agentsRepo` |
| `RepoIntelService` | `IndexPipelineDeps` + `repo`, `jobs`, `codeIndex`, `repoIntelEnabled` |

Nothing needs more than six. Nothing needs `Container`.

Two conventions fall out of this:

- **Inject the narrowest thing that works.** `WorkspaceService` takes
  `cloneDir: string`, not `AppConfig`; `RepoIntelService` takes
  `repoIntelEnabled: boolean`, not the config object. A service that only reads
  one field should not be able to reach the rest.
- **Compose Deps by extension, not duplication.** `ReviewDeps extends
  ReviewRunDeps` and `RepoIntelDeps extends IndexPipelineDeps`, because each
  forwards its own `deps` straight to the thing it constructs.

## Injecting lazily-resolved ports

Some ports are async and secret-dependent (`container.llm(id)`, `container.github()`).
Do not inject the Container to get at them — inject the **resolver function**:

```ts
// run-executor.ts — the port list lives next to the class that needs it
export interface ReviewRunDeps {
  git: GitClient;
  runBus: RunBus;
  repoIntel: RepoIntel;
  /** Lazily resolved per agent: an unconfigured provider must fail that run only. */
  llm: (provider: Provider) => Promise<LLMProvider>;
}

export class ReviewRunExecutor {
  constructor(private deps: ReviewRunDeps, /* … */) {}
}
```

The call site supplies it, keeping caching and secret lookup where they belong:

```ts
llm: (provider) => container.llm(provider),   // resolver, not the container
```

A resolver function is a legitimate port: it is an interface
(`(id) => Promise<T>`), it hides the implementation, and it is trivially mockable
as `async () => fakeLlm`. Wrapping the call preserves laziness — a missing
`ANTHROPIC_API_KEY` must fail the run that needs it, not app startup.

## Wiring: a Deps object, built in layer 5

Repositories are lazily-constructed members of the Container, so a service never
builds its own:

```ts
// platform/container.ts — the composition root
get pollingRepo(): PollingRepository {
  return (this._pollingRepo ??= new PollingRepository(this.db));
}
```

`routes.ts` is layer 5, so it may touch the Container. It maps the container onto
the service's `Deps`:

```ts
// ❌ hands over the whole composition root
const service = new PollingService(container);

// ✅ names exactly what the service may use
const service = new PollingService({
  repo: container.pollingRepo,
  github: () => container.github(),
});
```

**When the same `Deps` is built in more than one place, export a factory next to
the service** rather than repeating the literal — `reviewDeps(container)` and
`repoIntelDeps(container)` exist because `ReviewService` is built by both
`reviews/routes.ts` and the boot-time reaper in `app.ts`, and `RepoIntelService`
by both `container.repoIntel` and `repo-intel/routes.ts`. The factory takes a
structural parameter (`{ db, jobs, … }`), not `Container`, so the service module
still never imports the composition root.

## Rules for the Container itself

- It may import concrete adapters. That is its purpose.
- It must not contain business logic. If a getter makes a decision beyond
  "which implementation, is it cached", that decision belongs in a service.
  (`priceBook`'s degrade-to-`[]` and `embedder`'s config gate are borderline but
  acceptable: they are wiring policy, not domain rules.)
- Keep `ContainerOverrides` — it is how tests inject mocks at the root and it
  does not violate anything.
- Every port needs exactly one construction site here. Two places doing
  `new OctokitGitHubClient(token)` means the root has leaked.

## Migrating an existing service

Mechanical, one service at a time, green tests between each:

1. List what the class touches: `grep -o "container\.[a-zA-Z]*" service.ts | sort -u`.
2. Add those as constructor parameters; delete `private container: Container`.
3. Replace `this.container.x` with `this.x` throughout.
4. Replace `new XRepository(container.db)` with an injected `XRepository`; add
   the repository to the Container as a lazy getter if it is not there yet.
5. Add a `get <name>Service()` getter to the Container.
6. Update the construction sites — `routes.ts`, `app.ts:81`, and
   `container.ts:116` for `RepoIntelService`.
7. Update `server/CLAUDE.md`, whose module-shape note still describes the old
   Container-passing convention.
8. Run `pnpm typecheck && pnpm test` in `server/`.

Do not migrate all five at once. Each service is an independent, revertible commit.
