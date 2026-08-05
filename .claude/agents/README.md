# Agents

Custom subagents for DevDigest. Each runs in its own context window with its own
tool permissions, and returns a single report to the calling conversation.
Canonical location is `.claude/agents/`, shared with the team via version
control.

## Catalog

| Agent | Model | Writes? | Purpose |
|-------|-------|---------|---------|
| [researcher](researcher.md) | sonnet | no | Investigates a question — inside the repo or in external sources — and returns a structured report with evidence, citations, and an explicit list of what it could not find |
| [planner](planner.md) | opus | `specs/` only | Turns a request into a written Development Plan at `<package>/specs/NNNN-slug.md` — affected modules, architectural constraints, ordered steps, exact verification commands |
| [implementer](implementer.md) | sonnet | yes | Executes an approved plan across `server/`, `client/`, `reviewer-core/`, `e2e/`; runs that package's typecheck, tests and `arch:check`; reports what was verified and what was not |
| [test-writer](test-writer.md) | sonnet | tests only | Writes and runs tests for existing code across `client/`, `server/`, `reviewer-core/`, `e2e/`; honours the `*.it.test.ts` split; never edits production code to make a test pass |
| [architecture-reviewer](architecture-reviewer.md) | opus | no | Judges layering and boundaries — onion rules in `server/`/`reviewer-core/`, `client/CLAUDE.md` rules on the frontend — with `file:line` plus a quoted line for every finding |
| [plan-verifier](plan-verifier.md) | opus | no | Gives every item of a `specs/` plan an explicit verdict (done / partial / not done / deviation / unverifiable) backed by code, and refuses to substitute general code-quality advice |
| [doc-writer](doc-writer.md) | sonnet | `docs/` only | Turns shipped behaviour into a deep-dive in the right package's `docs/`, with Mermaid diagrams and no claim it did not read in the code |

## The planning pipeline

`planner` and `implementer` are two halves of one workflow, split so the plan
becomes a reviewable artefact rather than a step buried in a conversation:

```
planner ──▶ <package>/specs/NNNN-slug.md ──▶ implementer ──┬──▶ test-writer
             Status: draft                                 │
                  │                                        ├──▶ architecture-reviewer
            human review                                   │
            Status: accepted                               ├──▶ plan-verifier
                                                           │
                                                           └──▶ doc-writer ──▶ <package>/docs/
                                                                    │
                                                                    ▼
                                                             pr-self-review
                                                                    │
                                                                    ▼
                                                              gh pr create
```

The file is the hand-off channel, not the conversation. A subagent starts with
a **clean context** — it never sees the parent conversation or another
subagent's work — so anything the implementer needs must be written down. The
file also means the plan can be edited by a human before execution, and the
implementer can be re-run without re-planning.

The four post-implementation agents are **independent**: none reads another's
output, so they may run in any order or in parallel. They sit after
`implementer` only because they need code to exist. `doc-writer` is the natural
last step — a doc written before `plan-verifier` has run may describe a
half-finished feature. `pr-self-review` remains the pre-PR gate and is **not**
one of these agents; it is a skill, run from the main conversation.

**Scope boundaries.** The implementer verifies its own changes with
deterministic checks only (typecheck, tests, `arch:check`). Architectural and
security review belong to separate agents; `pr-self-review` remains the pre-PR
gate. See "What the implementer does not run" in
[implementer.md](implementer.md).

## Conventions these agents follow

Shared decisions, so a fourth agent can be written consistently:

- **No skill preloading.** No agent declares `skills:` in frontmatter. All of
  them see the descriptions of the 14 project skills and load what they need
  through the `Skill` tool — the same mechanism the main conversation uses. A
  new skill in `.claude/skills/` is therefore available immediately, with no
  frontmatter edit.
- **No delegation.** `Agent` is absent from every agent's `tools`, so none of
  them spawn subagents. Prevents unbounded cost trees and the stale
  "later wave" comments recorded in the root `INSIGHTS.md`.
- **No web access outside `researcher`.** `WebSearch`/`WebFetch` are denied to
  `planner`, `implementer`, `test-writer`, `architecture-reviewer`,
  `plan-verifier` and `doc-writer` — reading documentation instead of the code
  is a failure mode, and external research is `researcher`'s job.
- **Read-only by construction.** `researcher`, `architecture-reviewer` and
  `plan-verifier` all carry `disallowedTools: Write, Edit, NotebookEdit`. A
  reviewer that can patch its own findings destroys the evidence and returns a
  report nobody can audit.
- **Write scope is narrowed in the body, not only in `tools`.** `tools` cannot
  express a path restriction, so the prompt carries it: `planner` writes only to
  `specs/`, `test-writer` only to test files and test helpers, `doc-writer` only
  to `docs/`. The boundary rests on the agent — reviewing its diff stays a
  human's job.
- **`plan-verifier` deliberately has no `Skill` tool.** Skills pull it toward
  general code-quality advice, which is the one thing it must not produce. Do
  not "fix" this by adding `Skill`.
- **Least privilege via `tools`, not `permissionMode`.** `permissionMode` is
  ignored when the parent session runs in `auto`, and the parent's
  `bypassPermissions`/`acceptEdits` takes precedence — so it is not a barrier.
  Restrictions live in `tools`/`disallowedTools` and in the prompt body.
- **Reply in the language of the request; write artefacts in English.** Reports
  follow the conversation's language. Plan files, code, commit messages, and
  `INSIGHTS.md` entries are always English — they sit in the repo next to
  English code and are read by the next agent.
- **Mandatory "what I could not find / could not run" section.** Every agent's
  report has one. A check that did not run is not a check that passed.

## Frontmatter reference

Fields these agents use, and what they mean:

| Field | Effect |
|-------|--------|
| `name` | Unique id, lowercase and hyphens. Also the `@name` handle |
| `description` | How the model decides to delegate here. Third person, "what it does" + "when to use" + trigger terms. Keep the key phrase first — the listing truncates at 1536 characters |
| `model` | `sonnet` \| `opus` \| `haiku` \| `fable` \| explicit id \| `inherit`. **Defaults to `inherit`** |
| `tools` | Allowlist. **Omitting it inherits every tool**, which is rarely what you want. An entry that resolves to nothing fails the spawn |
| `disallowedTools` | Denylist, applied over `tools` |
| `maxTurns` | Cap on agentic turns — a guard against loops |

Other supported fields not used here: `skills` (preload), `permissionMode`,
`hooks`, `mcpServers`, `memory`, `background`, `effort`, `isolation`, `color`.

## Sources

The design of these agents is based on:

**Official Claude Code documentation** (verified against CLI 2.1.222, August 2026)

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) —
  frontmatter fields, context isolation ("what loads at startup"), the
  *chain subagents* pattern, single-responsibility guidance
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — how
  subagents discover and invoke skills, `skills:` preloading vs the `Skill` tool
- [Choose a permission mode](https://code.claude.com/docs/en/permission-modes) —
  why `permissionMode` is not a reliable barrier inside a subagent
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) —
  third-person descriptions with trigger terms; the *plan-validate-execute*
  pattern and "create verifiable intermediate outputs", which is why the plan
  is a file

**This repository**

- [`researcher.md`](researcher.md) — the house style all three share: hard
  constraints with stated motivation, the `## Clarification needed` block,
  honesty rules, report templates
- [`server/specs/README.md`](../../server/specs/README.md) — the `specs/`
  convention the plan format extends: `NNNN-short-slug.md`, `Status`
  lifecycle, "written before the code"
- [`.claude/skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md) —
  the file → skill map and the rule that a package's `CLAUDE.md` and
  `INSIGHTS.md` are read before touching it
- Root and per-package `INSIGHTS.md` — the tooling traps written into the
  implementer's verification section (`arch:check` exiting 0 despite
  violations, an unresolved `pnpm-workspace.yaml`, `.bin/` shims on Windows,
  the twice-vendored `@devdigest/shared`)
- [`TESTING.md`](../../TESTING.md) — the per-package suite map and the
  `*.it.test.ts` split that `test-writer` enforces
- The four `docs/README.md` files (`server/`, `client/`, `reviewer-core/`,
  `e2e/`) — each states different admission rules, and together they define
  `doc-writer`'s routing
- [`server/specs/0003-four-new-subagents.md`](../../server/specs/0003-four-new-subagents.md) —
  the plan these four were built from, including the external research behind
  the mutation check, the false-positive filter, the terse-verdict rule and the
  Diátaxis compass

## Adding an agent

1. Create `<name>.md` with the frontmatter above. Set `tools` explicitly.
2. Write the body: role, hard constraints (with reasons), method, output
   format, honesty rules. Do not restate `CLAUDE.md` — every agent except the
   built-in `Explore`/`Plan` receives it automatically.
3. Add a row to the catalog above, in the same commit.
4. Verify by running it once: if `tools` names a tool that does not resolve,
   the spawn fails outright — that is the frontmatter check.
