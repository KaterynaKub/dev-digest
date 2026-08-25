# Agents

Custom subagents for DevDigest. Each runs in its own context window with its own
tool permissions, and returns a single report to the calling conversation.
Canonical location is `.claude/agents/`, shared with the team via version
control.

## Catalog

| Agent | Model | Writes? | Purpose |
|-------|-------|---------|---------|
| [researcher](researcher.md) | sonnet | no | Investigates a question — inside the repo or in external sources — and returns a structured report with evidence, citations, and an explicit list of what it could not find |
| [spec-creator](spec-creator.md) | opus | `docs/specs/` only | Authors specifications at `docs/specs/SPEC-NN-slug.md` — problem, goals, user stories, EARS acceptance criteria, edge cases, provenance, traceability, verification notes. Reviews supplied designs for uncovered corner cases, unclear module interactions and weak UX; asks the user about everything undecidable and requests `researcher` runs for what it cannot read itself; self-checks before reporting. Never writes plans or code |
| [implementation-planner](implementation-planner.md) | opus | `.claude/plans/` only | Audits the requirements, asks about what is undecidable, then writes an Implementation Plan at `.claude/plans/NNNN-slug.md` — affected modules, architectural constraints, ordered steps, exact verification commands, and whether to run it single- or multi-agent. Never writes specifications |
| [implementer](implementer.md) | sonnet | yes | Executes an approved plan across `server/`, `client/`, `reviewer-core/`, `e2e/`; runs that package's typecheck, tests and `arch:check`; reports what was verified and what was not |
| [test-writer](test-writer.md) | sonnet | tests only | Writes and runs tests for existing code across `client/`, `server/`, `reviewer-core/`, `e2e/`; honours the `*.it.test.ts` split; never edits production code to make a test pass |
| [architecture-reviewer](architecture-reviewer.md) | sonnet | no | Judges layering and boundaries — onion rules in `server/`/`reviewer-core/`, `client/CLAUDE.md` rules on the frontend — with `file:line` plus a quoted line for every finding |
| [plan-verifier](plan-verifier.md) | sonnet | no | Gives every item of a `.claude/plans/` plan — and the `docs/specs/` criteria it cites — an explicit verdict (done / partial / not done / deviation / unverifiable) backed by code, and refuses to substitute general code-quality advice. Runs twice: pass 1 for coverage right after implementation, pass 2 after tests exist |
| [doc-writer](doc-writer.md) | sonnet | `docs/` only | Turns shipped behaviour into a deep-dive in the right package's `docs/`, with Mermaid diagrams and no claim it did not read in the code |

## The planning pipeline

`spec-creator`, `implementation-planner` and `implementer` are three stages of
one workflow, split so that both the specification and the plan become
reviewable artefacts rather than steps buried in a conversation:

```
spec-creator ──▶ docs/specs/SPEC-NN-slug.md ──┐
                      Status: draft           │
                            │                 │
                      human review            │
                      Status: approved        │
                                              ▼
implementation-planner ──▶ .claude/plans/NNNN-slug.md ──▶ implementer
                                Status: draft                    │
                                      │                          ▼
                                human review              plan-verifier (pass 1)
                                Status: accepted                 │
                                                                 ▼
                              [test-writer] ∥ architecture-reviewer
                                                                 │
                                                                 ▼
                                                        plan-verifier (pass 2)
                                                                 │
                                                                 ▼
                                                     doc-writer ──▶ <package>/docs/
                                                                 │
                                                                 ▼
                                                          pr-self-review
                                                                 │
                                                                 ▼
                                                           gh pr create
```

`implementer` accepts a plan at `Status: accepted` without asking; a plan still
at `draft` stops it for one confirming question, because a draft has not passed
human review. The order after implementation is explained under
"The post-implementation order" below — it is not arbitrary.

The file is the hand-off channel, not the conversation. A subagent starts with
a **clean context** — it never sees the parent conversation or another
subagent's work — so anything the implementer needs must be written down. The
file also means the plan can be edited by a human before execution, and the
implementer can be re-run without re-planning.

**Plans are not specifications.** A specification holds *what the system must
do and why*; a plan holds *how we will build it and in what order*. A spec is
input to a plan; a plan never becomes a spec. Three directories, three owners:

| Directory | Holds | Numbering | Written by |
|---|---|---|---|
| `docs/specs/SPEC-NN-slug.md` | Requirements — problem, stories, EARS criteria | once for the whole repo | `spec-creator` |
| `.claude/plans/NNNN-slug.md` | Implementation plans — steps, constraints, verification | once for the whole repo | `implementation-planner` |
| `<package>/specs/NNNN-slug.md` | Historical per-package specs and `e2e` flow files | per package | humans only — no agent writes there |

`implementation-planner` reads all three and writes only to `.claude/plans/`;
`spec-creator` reads all three and writes only to `docs/specs/`. Neither
boundary is enforced by tooling — both rest on the agent prompt.

**Execution mode is decided in the plan.** `implementation-planner` defaults to
a single-agent pass and asks the user only when the change splits into tracks
with disjoint file sets and a clean seam. The chosen mode is recorded in the
plan's `**Mode:**` header, so `implementer` knows whether it owns the whole
plan or one track of it.

### Running it: `/sdd`

The authoring half is manual — you run `spec-creator`, review the spec, run
`implementation-planner`, review the plan. The **execution** half is one
command:

```
/sdd <plan path> [spec path] [extra requirements] [design images]
```

`.claude/skills/sdd/` orchestrates it: implementer batches → `plan-verifier`
pass 1 → remediation → `architecture-reviewer` → fix findings (**max 2
iterations**) → `plan-verifier` pass 2 → report. It stops at the report;
`pr-self-review` and `gh pr create` stay manual behind their hook.

`/sdd` never writes a spec or a plan, and **does not run `test-writer`** — that
is a deliberate cost decision. Its final report names the criteria left
uncovered, so `test-writer` can be run manually where coverage is worth paying
for.

### The post-implementation order

The four agents after `implementer` do not read each other's output, but they
are **not** interchangeable in time. The order that avoids paying twice —
`[brackets]` mark the stages `/sdd` leaves to a manual run:

```
implementer ──▶ plan-verifier (pass 1) ──▶ [implementer, remediation] ──┐
                  coverage: what exists                                  │
                                                                         ▼
                      [test-writer]  ∥  architecture-reviewer  ──▶ plan-verifier (pass 2)
                                                                         │
                                                                    doc-writer
                                                                         │
                                                                  pr-self-review
                                                                         │
                                                                   gh pr create
```

**`plan-verifier` runs twice, and its first pass runs early.** Pass 1 asks only
"which plan items exist in the code" — the cheapest question in the pipeline,
and the one that decides whether there is anything worth reviewing. Reviewing
architecture or writing tests for a feature that is missing three acceptance
criteria means reviewing code that is about to change. Pass 2 runs after
`test-writer` and re-checks only what pass 1 left `unverifiable` or `partial`:
a test that did not exist then may settle those items now. Items already `done`
are carried forward, not re-derived. See "Two passes over the same plan" in
[plan-verifier.md](plan-verifier.md).

**`test-writer` and `architecture-reviewer` are genuinely parallel** — disjoint
outputs, neither reads the other.

**`test-writer` consumes the spec directly.** A `docs/specs/SPEC-NN` file's
`Traceability` table already assigns each criterion a kind of check, and its
`Edge cases` section already names the states worth covering. `test-writer`
reads both and reports coverage by criterion ID, which is what lets pass 2 close
an item by reading the report instead of re-investigating the code.

`doc-writer` stays last — a doc written before pass 2 may describe a
half-finished feature. `pr-self-review` remains the pre-PR gate and is **not**
one of these agents; it is a skill, run from the main conversation.

**Scope boundaries.** The implementer verifies its own changes with
deterministic checks only (typecheck, tests, `arch:check`). Architectural
review belongs to `architecture-reviewer`. See "What the implementer does not
run" in [implementer.md](implementer.md).

**Security review has no agent.** No subagent in this catalog owns it:
`architecture-reviewer` explicitly declines it, `plan-verifier` may not produce
it, and `implementer` does not attempt it. It is covered **only** by the
`pr-self-review` skill, at the pre-PR gate — which is late for a product whose
primary working material (pull requests, third-party repositories, model output)
is untrusted input. `spec-creator` writes an `## Untrusted inputs` section into
every spec; today nothing between that section and `pr-self-review` checks it.
A `security-reviewer` symmetrical to `architecture-reviewer` — read-only,
evidence-based, same severity scale — is the open gap in this pipeline.

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
- **Research is requested, not delegated.** Because of the rule above, an agent
  that hits a question it cannot answer — external sources, or a fan-out search
  across the repo — emits a numbered request block asking the user to run
  `researcher`, rather than spawning one. The user dispatches as many parallel
  `researcher` runs as there are questions, so each gets its own clean context.
  `spec-creator` documents the format under `## Requesting research`; it
  applies to any agent that needs the same.
- **No web access outside `researcher`.** `WebSearch`/`WebFetch` are denied to
  `spec-creator`, `implementation-planner`, `implementer`, `test-writer`,
  `architecture-reviewer`, `plan-verifier` and `doc-writer` — reading
  documentation instead of the code is a failure mode, and external research is
  `researcher`'s job. `spec-creator` therefore cannot open a Figma link: designs
  reach it as images or as written description.
- **Read-only by construction.** `researcher`, `architecture-reviewer` and
  `plan-verifier` all carry `disallowedTools: Write, Edit, NotebookEdit`. A
  reviewer that can patch its own findings destroys the evidence and returns a
  report nobody can audit.
- **Write scope is narrowed in the body, not only in `tools`.** `tools` cannot
  express a path restriction, so the prompt carries it: `implementation-planner`
  writes only to `.claude/plans/` and is barred from `specs/` entirely,
  `spec-creator` only to `docs/specs/SPEC-*.md`, `test-writer` only to test
  files and test helpers, `doc-writer` only to `docs/` outside `docs/specs/`.
  The boundary rests on the agent — reviewing its diff stays a human's job.
- **`plan-verifier` deliberately has no `Skill` tool.** Skills pull it toward
  general code-quality advice, which is the one thing it must not produce. Do
  not "fix" this by adding `Skill`.
- **Filter the test run during the work; run the full lane once at the end.**
  Every package's `test` script is a bare `vitest run` — the whole suite. An
  agent that re-runs 209 tests after each batch spends its context re-reading
  green lines about files it never touched. Use
  `pnpm exec vitest run --changed HEAD` while working (it selects the tests
  whose import graph reaches the uncommitted change — which is all of it, since
  no agent commits), and the unfiltered lane in the final pass so the closing
  numbers compare to the baseline. A filtered run is never reported as a
  baseline comparison, and a run that selected **no** tests is reported as
  such, not as a pass.
- **The baseline is measured once per plan, not once per batch.** A batched
  agent carries its baseline numbers forward in `## Next batch`; the next one
  reads them instead of re-measuring. A baseline taken on a tree a predecessor
  already modified absorbs their regressions into the starting line — the exact
  thing the baseline exists to expose.
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
  convention the plan format borrows its shape from: `NNNN-short-slug.md`,
  `Status` lifecycle, "written before the code". Plans live in
  `.claude/plans/` and `specs/` stays human-authored
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
