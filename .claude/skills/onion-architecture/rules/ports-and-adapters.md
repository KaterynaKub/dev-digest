# Ports and adapters

A **port** is an interface the application owns, phrased in domain terms. An
**adapter** is an implementation of that port using a real library. Onion and
Hexagonal agree here — the port belongs to the inside, the adapter to the outside
([Graça](https://herbertograca.com/2017/09/21/onion-architecture/)).

DevDigest's ports live in `server/src/vendor/shared/adapters.ts`, exported via
`@devdigest/shared`. Adapters live in `server/src/adapters/<capability>/`.

## When you need a port

Any time the application reaches outside its own process: HTTP APIs, the
filesystem, subprocesses, the clock, randomness, an LLM. If a unit test would
need the network to pass, the thing it calls belongs behind a port.

You do **not** need a port for: pure libraries (`zod`, `graphology`), Drizzle
(the repository already is the port), or Fastify (a driving adapter — it calls
you, you never call it).

## Designing the interface

Phrase it in **your** vocabulary, not the library's:

```ts
// ✅ domain language — two libraries could implement this
export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  currentHead(repo: RepoRef): Promise<string>;
}

// ❌ simple-git's vocabulary leaking through the port
export interface GitClient {
  raw(args: string[]): Promise<string>;
  simpleGitInstance(): SimpleGit;
}
```

Checklist for a good port:

- [ ] No type from the implementing library appears in the signature.
- [ ] Return types are domain types (layer 1) or plain structures.
- [ ] A second, unrelated implementation is imaginable. (`LLMProvider` has three:
      OpenAI, Anthropic, OpenRouter — that is why it is a good port.)
- [ ] Errors are domain errors from `platform/errors.ts`, not library errors.
- [ ] It is the *narrowest* interface the callers need — not the library's full
      surface.

## Adding a port + adapter

1. **Declare the port** in `server/src/vendor/shared/adapters.ts`:

   ```ts
   // ---------- Clock ----------
   export interface Clock {
     now(): Date;
   }
   ```

2. **Implement the adapter** in `server/src/adapters/<capability>/<impl>.ts`:

   ```ts
   import type { Clock } from '@devdigest/shared';

   export class SystemClock implements Clock {
     now(): Date { return new Date(); }
   }
   ```

   The adapter imports the port. The port never imports the adapter — that is
   the inversion.

3. **Export it** from `server/src/adapters/index.ts` (the adapter barrel).

4. **Wire it** in `platform/container.ts` as a lazy getter plus a
   `ContainerOverrides` entry:

   ```ts
   export interface ContainerOverrides {
     clock?: Clock;
   }

   get clock(): Clock {
     if (this.overrides.clock) return this.overrides.clock;
     this._clock ??= new SystemClock();
     return this._clock;
   }
   ```

5. **Inject it** into the services that need it — as a constructor parameter,
   never by handing over the Container. See [composition-root.md](composition-root.md).

6. **Add a mock** in `server/src/adapters/mocks.ts` for tests.

## Secret-dependent adapters

Adapters needing credentials are resolved **asynchronously** through
`SecretsProvider`, because the secret may be set at runtime via the UI:

```ts
async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

Three invariants:

- Throw `ConfigError` when the secret is missing — never construct a client with
  an empty key and fail later at the API.
- Cache the built client, and drop the cache in `invalidateSecretCaches()` when
  a key changes.
- Never read `process.env` for a secret inside an adapter. Secrets come from
  `SecretsProvider` (`~/.devdigest/secrets.json`), never from `AppConfig`, the
  DB, or git.

Services consume these as an injected resolver (`() => Promise<GitHubClient>`),
not by receiving the Container.

## Facade ports over a whole module

`RepoIntel` (`modules/repo-intel/types.ts`) is a port whose implementation is a
service, not a library. That is legitimate: it lets `reviews/run-executor.ts`
depend on an interface rather than on the indexer's internals, and lets tests
inject a degraded stub via `ContainerOverrides.repoIntel`.

Use this when a module is consumed by other modules. The facade goes in the
owning module's `types.ts`; the consumer imports only the interface.

## Adapters must not import modules

`adapters/**` is layer 5 but sits *beside* the modules, not above them. An
adapter that imports `modules/*/service.ts` has created a cycle through the
composition root. If an adapter seems to need business logic, the logic belongs
in the service that calls the adapter.
