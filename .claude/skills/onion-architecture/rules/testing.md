# Testing the onion

Correct layering shows up as cheap tests. If a test is expensive to set up, the
code under test is usually reaching through a layer it should not.

## Test per layer

| Layer | What you write | Infrastructure needed |
|---|---|---|
| 1 Domain model | schema parse/reject cases | none |
| 2 Domain services | pure unit tests, literal in → literal out | none |
| 3 Ports | nothing — interfaces have no behaviour | none |
| 4 Application services | use-case tests with fake ports | none |
| 5 Infrastructure | adapter + repository integration tests | Postgres / network |

The first four columns are the hermetic suite. Only layer 5 needs a container.

## The naming rule decides your suite

**DB-backed tests must be named `*.it.test.ts`.** Anything else lands in the
hermetic suite and will fail CI if it touches Postgres. This is not a style
preference — it is how `TESTING.md` splits the runs.

```
test/agents-versions.it.test.ts   → integration, testcontainers Postgres
test/grounding.test.ts            → hermetic, no infrastructure
```

## Testing an application service

Explicit port injection makes this trivial — construct the class with hand-written
fakes and nothing else:

```ts
import { describe, it, expect } from 'vitest';
import { RepoService } from '../src/modules/repos/service.js';

describe('RepoService.runCloneJob', () => {
  it('authenticates the clone URL with the stored PAT', async () => {
    const cloned: string[] = [];
    const service = new RepoService(
      { updateClonePath: async () => {} } as any,          // repository fake
      { clone: async (_r, url) => { cloned.push(url); return { path: '/tmp/x' }; } } as any,
      { get: async () => 'ghp_secret' } as any,            // secrets fake
      { enqueue: async () => {}, register: () => {} } as any,
    );

    await service.runCloneJob({ repoId: 'r1', owner: 'o', name: 'n', url: 'https://github.com/o/n' });

    expect(cloned[0]).toContain('ghp_secret');
  });
});
```

No database, no Container, no `testcontainers`. **This test is the payoff for
[composition-root.md](composition-root.md)** — with `constructor(container: Container)`
the same test would need a Postgres handle, an SSE bus, and a JobRunner it never
calls.

## Fakes vs. `ContainerOverrides`

Both are legitimate; pick by scope:

- **Hand-written fakes** for unit-testing one service. Fastest, most explicit,
  and they document exactly which methods the use case touches.
- **`ContainerOverrides`** for route/integration tests that boot the app. This is
  the composition root's injection seam and is why the app can run with zero
  network calls in tests.

```ts
const container = new Container(config, db, {
  github: mockGitHubClient,
  llm: { openai: mockLlm },
  repoIntel: degradedRepoIntel,
});
```

Reusable mocks live in `server/src/adapters/mocks.ts`.

## Testing routes

Use Fastify's `inject()` against an app built with a mock-injected Container. The
test asserts the HTTP contract — status, shape, validation errors — not the
business rule, which is already covered at layer 4.

## Testing adapters

Adapters are where real I/O is allowed. Test them against the real thing
(testcontainers Postgres, a recorded fixture) and name them `*.it.test.ts` when
they need a database. An adapter test should assert *translation*: that library
output becomes the port's domain type correctly.

## What good layering feels like in tests

- Adding a field to a contract breaks the parse test and nothing else.
- Changing a SQL query breaks one repository test.
- Swapping an LLM provider breaks no test above layer 5.
- A use-case test never mentions `drizzle-orm`, `fastify`, or `Container`.

If a small change cascades across many test files, the layering leaked
somewhere — usually a persistence type escaping a repository
([persistence.md](persistence.md)).

## Architecture is tested too

`pnpm arch:check` is part of the suite. A layering violation fails CI exactly
like a failing assertion — see [enforcement.md](enforcement.md).
