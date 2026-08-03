# Domain purity — `reviewer-core` and layer 2

`reviewer-core/` is the pure core of DevDigest and the reference implementation
of a clean onion centre. Protect it aggressively: every dependency added there
is one the whole architecture inherits.

## What makes it pure

The pipeline is `diff → prompt → LLM → grounded findings`. No database, no
GitHub, no filesystem. The only side effect is a call through an injected
`LLMProvider`.

Its entire dependency list is `openai` and `zod` — and `openai` only because the
shared `OpenRouterProvider` lives there for the CI runner.

## Rules

### 1. Nothing enters that is not already inside

`reviewer-core` may import `@devdigest/shared` and `zod`. It must not import:

- `drizzle-orm`, `postgres`, anything from `server/src/db/**`
- `fastify`, `octokit`, `simple-git`
- `node:fs`, `node:child_process`
- anything from `server/src/**`

If `reviewer-core` seems to need something from `server/`, the shared piece
belongs in `@devdigest/shared` instead. Moving it there is the fix; importing
outward never is.

### 2. Side effects arrive as injected ports

The engine does not fetch the diff, does not read the repo, does not persist
findings. Everything it needs is passed in; the one capability it invokes is an
interface it was handed.

```ts
// ✅ the caller supplies the port
export async function reviewPullRequest(
  input: ReviewInput,
  llm: LLMProvider,
): Promise<ReviewOutcome> { … }
```

### 3. The package emits no JS

`build` is a type-check (`tsc --noEmit`). The server consumes the TypeScript
source through a path alias. **Do not add a `dist/`** — the aliasing is what
keeps `server` and the CI `agent-runner` on one copy of the logic.

### 4. Domain invariants live here, not in callers

Three rules are enforced inside the core and must never be relaxed by a caller:

- **Grounding is mandatory.** A finding that does not cite a line present in the
  diff is dropped. Never add a bypass flag.
- **The score is recomputed** from surviving findings; the model's self-reported
  score is ignored by design.
- **Injection defense is one trusted rule** (`INJECTION_GUARD`) — never keyword
  scanning of untrusted text.

A caller that could switch these off would move the invariant out of the domain,
which is exactly what layering is meant to prevent.

### 5. Prompt assembly is pure

Empty slots omit their whole section, never an empty heading. That is a pure
function of the inputs — assembled in the core, testable with literals, no
mocks.

## Purity inside `server/` — `helpers.ts`

The same standard applies to per-module `helpers.ts` (layer 2):

- No `await` on I/O, no injected dependencies, no imports pointing outward.
- Takes domain types, returns domain types.
- Testable with literal inputs and zero mocks.

```ts
// ✅ helpers.ts — pure
export function withGitHubToken(url: string, token: string): string { … }
export function toAgentDto(row: AgentRow): Agent { … }

// ❌ helpers.ts — this is layer 4
export async function fetchAndFormat(id: string, db: Db) { … }
```

The test is mechanical: **if a unit test needs a mock, it is not a helper.**

## Why guard the centre so hard

The core changes on business rhythm; infrastructure changes on vendor rhythm.
Palermo's original argument was that data-access techniques churn every few
years and drag coupled applications into legacy status. A pure centre means
swapping OpenAI for Anthropic, or Postgres for anything else, touches the edges
only — which is precisely what `reviewer-core` already demonstrates by running
unchanged under both the server and the CI runner.
