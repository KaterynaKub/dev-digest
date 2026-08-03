# The HTTP boundary — `routes.ts`

Layer 5, driving side. Fastify calls *you*; you never call Fastify from inside.
The route is a translator: HTTP in → service call → HTTP out. It holds no
business rules.

## Anatomy

```ts
import type { FastifyInstance } from 'fastify';
import { CreateRepoRequest, Repo } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';

export async function repoRoutes(app: FastifyInstance) {
  const service = app.container.repoService;      // resolved, not constructed

  app.post('/repos', {
    schema: {
      body: CreateRepoRequest,                    // Zod contract validates
      response: { 201: Repo },                    // …and serializes
    },
  }, async (req, reply) => {
    const { workspaceId } = await getContext(req);
    const repo = await service.add(workspaceId, req.body);
    return reply.code(201).send(repo);
  });
}
```

Three lines of translation and one service call. That is the whole job.

## Rules

### 1. Zod contracts drive validation *and* serialization

Declare schemas in the route's `schema` block via `fastify-type-provider-zod`.
Never hand-roll `Schema.parse(req.body)` inside a handler — that bypasses the
response serializer, loses the generated types, and lets internal fields leak
into responses.

```ts
// ❌ hand-rolled, no response contract
app.post('/repos', async (req) => {
  const body = CreateRepoRequest.parse(req.body);
  return service.add(body);                        // returns whatever it returns
});
```

The response schema is the anti-corruption layer: a field the contract does not
name cannot reach the client, even if a repository accidentally returns it.

### 2. No persistence below the route

`routes.ts` must not import `drizzle-orm`, `db/**`, or any `repository.ts`. A
route needing data calls a service method — add one if it is missing.

### 3. No business rules

Branching on domain state (which agents run, whether a finding blocks CI, how a
score is computed) belongs in layer 4 or 2. Routes branch only on HTTP concerns:
method, status, content type.

### 4. Errors map at the edge

Services throw `NotFoundError`, `ConfigError`, and friends from
`platform/errors.ts`. A single error handler maps those to status codes. Do not
try/catch in every handler to build responses by hand.

### 5. Workspace comes from the context

Resolve it once per request with `getContext(req)` and pass it explicitly into
the service. Never let a service reach back into the request.

### 6. Long work returns ids

Reviews are background jobs: the route enqueues, gets a run id, returns
immediately, and progress streams over SSE. Do not await execution in a handler
— it ties a use case's duration to an HTTP timeout.

### 7. Registration is static

Modules are registered by hand in `server/src/modules/index.ts`. Never add
autoloading — explicit registration is what makes the wiring greppable and the
boot order predictable.

## SSE endpoints

Streaming routes are still layer 5. They subscribe to the injected `RunBus` and
forward events; they do not compute what to send. The service publishes domain
events to the bus, the route serialises them to the wire.

## Which skill governs what

Fastify mechanics — plugin encapsulation, hooks, lifecycle, `inject()` testing,
CORS, rate limiting — belong to the `fastify-best-practices` skill. Contract
authoring belongs to `zod`. This skill governs only the boundary discipline:
what a route may import, and what must never sink below it.

## Checklist

- [ ] `schema` block declares body/params/query **and** response.
- [ ] Service resolved from `app.container`, not constructed inline.
- [ ] No `drizzle-orm`, no `db/**`, no `repository.ts` import.
- [ ] No domain branching in the handler.
- [ ] `workspaceId` from `getContext(req)`, passed explicitly.
- [ ] Errors thrown, not hand-mapped.
- [ ] Registered in `modules/index.ts`.
