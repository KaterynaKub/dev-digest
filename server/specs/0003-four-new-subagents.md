# 0003 — Four new Claude Code subagents: test-writer, architecture-reviewer, plan-verifier, doc-writer

**Status:** draft
**Date:** 2026-08-05
**Touches:** `.claude/agents/test-writer.md` · `.claude/agents/architecture-reviewer.md` · `.claude/agents/plan-verifier.md` · `.claude/agents/doc-writer.md` · `.claude/agents/README.md`

> This plan lives in `server/specs/` because the repository has no root-level
> `specs/` directory and `.claude/` is not a package. `server/specs/` is the
> de-facto home for cross-cutting plans (contracts and conventions flow
> downstream from it). **Nothing under `server/src/**` changes** — this plan
> adds five markdown files under `.claude/agents/` and nothing else. Numbering
> is per-package; `0003` is the next free number in `server/specs/`
> (`0001-skills-module.md`, `0002-conventions-extractor.md` exist).

## Problem

`.claude/agents/` currently holds three agents — `researcher` (read-only
investigation), `planner` (writes `<package>/specs/NNNN-slug.md`), and
`implementer` (executes a plan). The pipeline therefore stops the moment code
lands: everything after implementation is done ad hoc in the main conversation,
where it has no isolated context, no fixed report format, and no tool
restrictions.

Four concrete gaps, each observable today:

1. **Tests are written by whoever happens to be in the conversation.** The repo
   has a hard, easy-to-miss convention — a DB-backed test must be named
   `*.it.test.ts`, or it lands in the hermetic lane and tries to open a
   connection there (`TESTING.md`, root `CLAUDE.md`). There is also no
   `test:unit`/`test:integration` script to lean on: `server/package.json` is
   `skip-worktree`, so the split is invoked as `pnpm exec vitest run --exclude
   '**/*.it.test.ts'` and `pnpm exec vitest run .it.test`. Nothing in the agent
   layer encodes this.
2. **Architectural review has no owner.** `implementer.md` explicitly says
   "Does not perform architectural or security review — separate agents own
   that", and `.claude/agents/README.md` promises "(review agents)" in its
   pipeline diagram. That agent does not exist. `pnpm arch:check` exists in
   `server/` and `reviewer-core/` only, exits 0 even with violations (root
   `INSIGHTS.md`), and the frontend has **no** automated architecture gate at
   all.
3. **Nobody checks the code against the plan.** The `implementer` reports on
   itself. Its own report is the only record of whether every step of the plan
   was actually done — and a self-report is exactly where "partially done"
   quietly becomes "done". The failure mode this must avoid is well documented
   in the repo: general code-quality commentary substituting for a point-by-point
   verdict.
4. **Documentation is written from memory, if at all.** Every package has a
   `docs/README.md` stating precisely what belongs there and what does not, and
   the four differ. Nothing consumes those rules.

## Approach

Add four subagent definition files to `.claude/agents/`, plus a catalog and
pipeline update in `.claude/agents/README.md`. Five markdown files; no code, no
config, no `package.json`, no skills.

Each new agent copies the house style already established by
`researcher.md` / `planner.md` / `implementer.md` — same frontmatter field set,
same `## Hard constraints` with stated motivation, same `## Clarification
needed` block for undecidable input, same mandatory "what I could not
find / could not run" section, same honesty rules ("reply in the language of
the request; artefacts in the repo are always English").

| Agent | Model | Writes | One-line role |
|---|---|---|---|
| `test-writer` | `sonnet` | test files only | Writes and runs tests for the package it was pointed at |
| `architecture-reviewer` | `opus` | nothing | Judges layering/boundary compliance with file:line evidence |
| `plan-verifier` | `opus` | nothing | Per-plan-item verdict: done / partial / not done / deviation |
| `doc-writer` | `sonnet` | `docs/` + `README.md` only | Turns shipped behaviour into a doc with Mermaid diagrams |

Files that change:

- `.claude/agents/test-writer.md` (new)
- `.claude/agents/architecture-reviewer.md` (new)
- `.claude/agents/plan-verifier.md` (new)
- `.claude/agents/doc-writer.md` (new)
- `.claude/agents/README.md` (edit — catalog rows, pipeline diagram, a note in
  "Conventions these agents follow" that two of the four are read-only)

## Rejected alternatives

**One `reviewer` agent covering architecture + plan conformance + tests.**
Rejected: the official subagent guidance the existing README already cites is
single-responsibility, and the three jobs have incompatible failure modes. An
architecture reviewer that also checks plan items will drift into generic code
review — which is the exact defect `plan-verifier` exists to prevent.

**Folding test-writing into `implementer`.** Rejected: the implementer is
already at `maxTurns: 200` and is deliberately scoped to the plan's `Touches:`.
Tests for a change are frequently a separate, larger pass over files the plan
never named, and they need a different skill set (`react-testing-library` vs
`onion-architecture`). Keeping them apart also means tests can be regenerated
without re-running the implementation.

**Giving `architecture-reviewer` and `plan-verifier` write access "so they can
fix what they find".** Rejected for the same reason `researcher` has none: a
reviewer that patches its own findings destroys the evidence and returns a
report nobody can audit. Both get `disallowedTools: Write, Edit, NotebookEdit`.

**Preloading `skills:` in frontmatter.** Rejected — the README records an
explicit repo-wide decision: no agent declares `skills:`; all load through the
`Skill` tool so a new skill in `.claude/skills/` is available with no
frontmatter edit. The four new agents follow it.

**Using `permissionMode` to enforce read-only.** Rejected — the README already
documents that `permissionMode` is ignored when the parent runs in `auto` and is
overridden by `bypassPermissions`/`acceptEdits`. Restrictions live in
`tools`/`disallowedTools` and in the prompt body.

**A separate `docs/` plan file per package for `doc-writer`.** Rejected: the four
`docs/README.md` files already state their own rules; the agent reads them at
run time rather than carrying a stale copy.

## Affected packages and modules

| Package | Path | What changes | Layer (backend only) |
|---|---|---|---|
| — (repo tooling) | `.claude/agents/test-writer.md` | new agent definition | — |
| — (repo tooling) | `.claude/agents/architecture-reviewer.md` | new agent definition | — |
| — (repo tooling) | `.claude/agents/plan-verifier.md` | new agent definition | — |
| — (repo tooling) | `.claude/agents/doc-writer.md` | new agent definition | — |
| — (repo tooling) | `.claude/agents/README.md` | catalog + pipeline + conventions | — |

No contract changes, so the twice-vendored `@devdigest/shared`
(`server/src/vendor/shared`, `client/src/vendor/shared`) is untouched by this
plan. The agents themselves must know about it — that is content, not a file
edit here.

## Facts established by reconnaissance

Everything below was read from the repo on 2026-08-05. The implementer must
copy these into the agent bodies verbatim rather than restating them from
memory — several are counter-intuitive.

### Scripts that actually exist (`package.json` per package)

| Package | Scripts |
|---|---|
| `server` | `dev`, `build`, `start`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:seed`, **`arch:check`**, `arch:graph` — **no `lint`** |
| `client` | `dev`, `build`, `start`, `typecheck`, **`lint`**, `test` — **no `arch:check`** |
| `reviewer-core` | `typecheck`, `build` (= `tsc --noEmit`, emits no JS), `test` (`vitest run --passWithNoTests`), **`arch:check`** |
| `e2e` | `test` (`tsx run.ts`), `e2e:hermetic` (`../scripts/e2e.sh`), `typecheck` |

`arch:check` is `depcruise src --config .dependency-cruiser.cjs` in both
`server/` and `reviewer-core/`. It exists **nowhere else**.

### Test layout

- `server/` — `server/test/*.test.ts` plus a few colocated
  (`src/modules/pulls/findings-summary.test.ts`). Vitest `include` is
  `['test/**/*.test.ts', 'src/**/*.test.ts']`. Integration files end
  `.it.test.ts` (`agents-versions.it.test.ts`, `conventions.it.test.ts`,
  `integration.it.test.ts`, `pulls-comments.it.test.ts`). Helpers in
  `server/test/helpers/` — `pg.ts` exposes `startPg()` and `dockerAvailable()`,
  and integration tests **self-skip** when Docker is unreachable.
  `testTimeout`/`hookTimeout` are 120 s because containers are slow.
- `client/` — tests are colocated as `<Name>.test.tsx` next to the component
  inside `src/app/<route>/_components/<Name>/`. Vitest: jsdom, `globals: true`,
  `setupFiles: ['./src/test/setup.ts']` (imports `@testing-library/jest-dom/vitest`
  and stubs `ResizeObserver`), `include: ['src/**/*.test.{ts,tsx}']`.
- `reviewer-core/` — tests live in `reviewer-core/test/*.test.ts`
  (`prompt.test.ts`, `run.test.ts`, `to-review.test.ts`, `run-cost.test.ts`),
  node environment.
- `e2e/` — **no `*.test.ts` at all.** `e2e/specs/` holds `*.flow.json`
  deterministic agent-browser flows, run in lexical filename order
  (`01-app-boot.flow.json` … `08-skills.flow.json`). `e2e/CLAUDE.md`: flows must
  stay read-only and LLM-free; a step fails when its command exits non-zero.

### Documented traps the agents must carry

- `pnpm arch:check` **exits 0 while reporting violations** (rules are
  `warn`-severity). Judge it by the summary line
  `x N dependency violations (E errors, W warnings)` — root `INSIGHTS.md`.
- Piping a check into `tail`/`head` **discards the exit code** — root
  `INSIGHTS.md`.
- An unresolved `pnpm-workspace.yaml` makes **any** `pnpm <script>` fail before
  the script runs (`ERR_PNPM_IGNORED_BUILDS`). Fallback is the real entry point,
  never the `.bin/` shim: `node node_modules/vitest/vitest.mjs run <filter>`,
  `node node_modules/typescript/bin/tsc`,
  `node node_modules/dependency-cruiser/bin/dependency-cruise.mjs` — root
  `INSIGHTS.md`.
- `tsc -p tsconfig.json` in `server` does **not** cover `test/` — a green
  typecheck does not mean the tests compile (`server/INSIGHTS.md`).
- `@devdigest/shared` is vendored twice with no sync script
  (`server/INSIGHTS.md`, `client/INSIGHTS.md`).
- `GitClient.readFile` throws on a missing file but `MockGitClient.readFile`
  returns `''` (`server/INSIGHTS.md`) — a live trap for test authors.
- `getByDisplayValue` never matches a multi-line textarea value; clicking a
  card's text does not trigger the card's own `onClick`; no top-level
  `*ListView` component has ever been rendered in a test (`client/INSIGHTS.md`)
  — all three are `test-writer` material.
- The `ui-frontend-architecture` skill describes a `src/features/*` canon that
  **does not exist here**; `client/CLAUDE.md` is authoritative.

### `docs/` layout (each README states different rules)

| Path | Holds | Explicitly excluded |
|---|---|---|
| `server/docs/` (`README.md`, `onboarding-notes.md`) | subsystem walkthroughs end-to-end, data models beyond the schema, operational guidance (migrations, seeding, troubleshooting) | traps → `../INSIGHTS.md`; planned changes → `../specs/`; route lists/env tables/DI diagram → `../README.md` |
| `client/docs/` (`README.md`) | how a screen/component family is structured and why, data-fetching & caching (TanStack Query keys, invalidation), app-shell/routing/i18n/theming | traps → `../INSIGHTS.md`; planned UI work → `../specs/`; route map & commands → `../README.md` |
| `reviewer-core/docs/` (`README.md`) | prompt anatomy section by section, grounding algorithm incl. edge cases, structured output & parse-with-repair | traps → `../INSIGHTS.md`; proposed engine changes → `../specs/`; pipeline diagram & public API → `../README.md` |
| `e2e/docs/` (`README.md`) | **all prose, because `specs/` is taken by `*.flow.json`** — command vocabulary, how a flow is structured, seeded data dependencies, *and* planned flow coverage | traps → `../INSIGHTS.md`; runner env vars & format → `../README.md`; actual flows → `../specs/*.flow.json` |

Shared rules across all four: naming is `short-slug.md`, one topic per file;
link to code by path, never paste code that will drift; "if a doc is only true
this week, it is a spec, not a doc" (`server/docs/README.md`).

Root `docs/` is a different thing entirely: `docs/agent-prompts/` holds the
**in-product review-agent system prompts** stored on `agents.system_prompt` in
the DB (`general-reviewer.md`, `security-reviewer.md`,
`performance-reviewer.md`, `test-quality-reviewer.md`, plus
`choosing-a-model.md`), and `docs/research/` holds one-off research notes.
Neither is a home for feature documentation, and `doc-writer` must not write
there without being asked.

## External practices applied

Two independent research passes ran on 2026-08-05: one over the official Claude
Code documentation, one over industry practice for test / verification /
documentation agents. Only findings that **changed something in this plan** are
recorded here; the source tables are at the end of this section.

### What the official documentation confirmed (no change needed)

- `disallowedTools` is a real, documented field — a denylist applied over
  `tools`. Both are used here, deliberately: the allowlist is the primary
  barrier, the denylist is defence in depth.
- `permissionMode` is **not** a barrier — it is ignored when the parent session
  runs in `auto`, and the parent's `bypassPermissions`/`acceptEdits` takes
  precedence. This plan's refusal to use it is correct.
- Omitting `Agent` from `tools` **mechanically** prevents subagent spawning; it
  is not a request the agent may decline.
- Official read-only examples (`code-reviewer`, `security-reviewer`) exclude
  `Write`/`Edit` through the `tools` allowlist, and `security-reviewer` is
  explicitly `model: opus` — the same shape and the same tier as
  `architecture-reviewer` here.
- The official *adversarial review* pattern is almost verbatim `plan-verifier`:
  *"review the diff against PLAN.md. Check that every requirement is
  implemented … Report gaps, not style preferences."*

### Changes to Step 1 — `test-writer`

Add a section **`## Would this test fail if the code were wrong?`**, placed
immediately after `## The testing philosophy of this repo`. Content:

1. **Coverage is not the signal.** A controlled comparison on real Python bugs
   found LLM-written tests detecting 69% of real defects versus 17.2% for
   typical human tests — at *near-identical* line coverage (84.8% vs 88.5%).
   Coverage does not distinguish a test that catches regressions from one that
   does not. Never report coverage as evidence a behaviour is tested.
2. **The tautological test is the failure mode to avoid by name.** Mocking a
   dependency, returning a payload, then asserting the function returned that
   payload tests the mock's configuration and nothing else. In this repo the
   trap is concrete: `MockGitClient.readFile` returns `''` where the real
   `GitClient.readFile` throws — a test written against the mock can pass on
   behaviour production does not have.
3. **"Improper assertions" — the documented LLM defect.** The input that
   triggers the bug is present, but no assertion can observe it. Every test must
   assert on a *value of the behaviour*, never on the fact that a mock was
   called.
4. **The mutation check, required per test before reporting.** For each test
   written, answer: *if I deliberately broke exactly the logic this test claims
   to cover, would this test go red?* If no, the test is not worth keeping —
   delete it and say so. This is the cheap form of mutation testing; no mutation
   tool is configured in any package, so this is a reasoning step, not a
   command.
5. **Write the guard with the fix.** When the subject is a bug fix, the
   regression test belongs in the same pass as the fix, while the failing input
   is known — not reconstructed later from the diff.

Also add one section to the report template, after `What I deliberately did not
cover`:

```markdown
## Mutation check
| Test | If I broke … | Would it go red? |
|---|---|---|
| `X.test.tsx:12` | the `costUsd` formatting branch | yes |
```

### Changes to Step 2 — `architecture-reviewer`

1. **Extend `## Evidence rules`** — a finding's evidence is the *import edge*,
   not a paraphrase: quote the offending `import` line and state `from → to`.
   "Layer X violates layer Y" without the edge is not a finding. This matches
   how both `dependency-cruiser` and `eslint-plugin-boundaries` report natively:
   file, line, and the specific dependency.
2. **New subsection `## Before you report it — the false-positive filter`**,
   inside `## Evidence rules`. Three checks, in order:
   - does the path fall under a `path`/`pathNot` exclusion in that package's
     `.dependency-cruiser.cjs` (tests, `.d.ts`, dev-dependencies)? If yes, it is
     not a violation;
   - is it inside the documented inherited baseline? Then it is debt, not a
     finding against this change;
   - for `client/`, does the finding rest on the `ui-frontend-architecture`
     skill's `src/features/*` canon? That canon does not exist here — such a
     finding is a false positive by construction, and `client/CLAUDE.md` wins.
3. **Sharpen the closing rule of `## Evidence rules`** with the documented
   antipattern, stated plainly: *a reviewer prompted to find gaps will usually
   report some, even when the work is sound, because that is what it was asked
   to do — and chasing every finding produces extra abstraction layers,
   defensive code, and tests for cases that cannot happen.* Therefore: **flag
   only what affects correctness or breaks a stated rule; everything else is
   explicitly optional and must be labelled as such.** An empty findings list is
   a good outcome, not a failed review.

### Changes to Step 3 — `plan-verifier`

This is the step the research changed most, and one finding runs **against** the
intuition that a stricter verifier should reason more.

1. **New rule inside `## Verdicts`: verdict length is bounded by verdict type.**
   A controlled study of LLMs verifying code against natural-language
   specifications found that prompting for *more* elaboration — explanations
   plus suggested fixes — **increased** the rate of wrong verdicts, chiefly by
   marking correct implementations as non-compliant. The countermeasure is not
   less structure but less prose:
   - `done` → one table row. Evidence quote, nothing else. No commentary, no
     "though it could be cleaner".
   - `partial`, `not done`, `deviation` → the table row **plus** a short detail
     entry, because here the reader needs to know precisely what is missing or
     different.
   - `unverifiable` → the row plus the one command or observation that would
     settle it.

   State this reason in the body, or a future edit will "improve" it by asking
   for more analysis everywhere.
2. **This does not soften the checklist.** The opposite finding is equally
   documented: a verifier given no criteria beyond "is this good?" rubber-stamps
   the generator's output. Detailed *criteria* with terse *verdicts* is the
   combination both lines of evidence support — and it is why the checklist is
   built from the plan **before** any code is read (Step 3 §5).
3. **New rule inside `## Evidence rules`: verify the quote itself.** After
   quoting a line as evidence, confirm that line exists at that path and line
   number by reading it — a fabricated or mis-numbered citation makes a verdict
   unauditable, the named failure mode of evidence-grounded evaluation
   ("unverifiable score attribution"). If a quote cannot be confirmed, the
   verdict drops to `unverifiable`.
4. **Reinforce the count discipline already in §5** with its documented name:
   *rubric execution drift* — the checker silently stops following the checklist
   and starts free-associating. The stated total, the numbered rows, and the
   "fewer verdicts than items is incomplete by construction" rule are the guard.

### Changes to Step 4 — `doc-writer`

1. **New section `## Which kind of document is this?`**, placed before
   `## Where the doc goes` — the package rules answer *where*, but not *what
   shape*. Add the Diátaxis compass, two axes:
   - does the content inform **action** or **cognition**?
   - does the reader need it while **studying** or while **working**?

   The four quadrants: action+study = tutorial · action+work = how-to guide ·
   cognition+work = reference · cognition+study = explanation. The finest
   distinction, and the one worth stating: **reference** is consulted *during*
   work; **explanation** is read to *understand*. Most of what this repo's
   `docs/` admits is explanation (subsystem walkthroughs, prompt anatomy, "why
   this exists") — reference material is deliberately pushed to each package's
   `README.md`. **The most common documentation defect is mixing quadrants in
   one file** — a "why" digression welded into a step-by-step. When that
   happens, split and cross-link rather than blend.
2. **Extend `## Diagrams`** with the C4 level rule: draw at Context and
   Container level, and Component level only where complexity earns it. **Never
   hand-draw the Code level** — it duplicates the source and goes stale
   immediately; link to the file instead. This is the practical form of the rule
   already in the house rules ("link to code by path, never paste code that will
   drift").
3. **One line to add to `## Verification`**, from docs-as-code practice: the doc
   belongs in the same change as the behaviour it describes. If the subject
   shipped in an earlier change, say so in the report — a doc landing long after
   the code is the normal way documentation drifts.

### Sources

**Official documentation (verified August 2026)**

| Source | URL | Used for |
|---|---|---|
| Create custom subagents | https://code.claude.com/docs/en/sub-agents | frontmatter field set; `disallowedTools` semantics; `Agent` absence blocks spawning; skills via the `Skill` tool vs `skills:` preload |
| Choose a permission mode | https://code.claude.com/docs/en/permission-modes | why `permissionMode` is not a barrier |
| Best practices for Claude Code | https://code.claude.com/docs/en/best-practices | adversarial review pattern; the "reviewer will always find something" antipattern; read-only reviewer examples and `model: opus` |
| Skill authoring best practices | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices | third-person descriptions with trigger terms; conciseness |

**Industry practice**

| # | Source | URL | Date | Applied to |
|---|---|---|---|---|
| 1 | LLM vs. Human Unit Tests: Fault Detection on Real Python Bugs (arXiv:2606.08588) | https://arxiv.org/pdf/2606.08588 | 09.06.2026 | coverage is not the signal (69% vs 17.2% fault detection at equal coverage) |
| 2 | Mutation-Guided LLM-based Test Generation at Meta (arXiv:2501.12862) | https://arxiv.org/pdf/2501.12862 | 22.01.2025 | the mutation check; writing the guard together with the fix |
| 3 | LLMs Are the Key to Mutation Testing and Better Compliance | https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/ | 30.09.2025 | same, industrial confirmation |
| 4 | Just-in-Time Catching Test Generation at Meta (arXiv:2601.22832) | https://arxiv.org/pdf/2601.22832 | 30.01.2026 | code-change-aware tests; test written at fix time |
| 5 | An Empirical Study of Unit Test Generation with LLMs (arXiv:2406.18181) | https://arxiv.org/html/2406.18181v1 | 2024 | "improper assertions" as the named LLM test defect |
| 6 | LLMs for Automated Unit Test Generation and Assessment (arXiv:2511.20403) | https://arxiv.org/pdf/2511.20403 | 27.11.2025 | weak assertions, implementation duplication, over-mocking |
| 7 | dependency-cruiser rules-reference | https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md | current | severity levels; `path`/`pathNot` as the false-positive filter |
| 8 | eslint-plugin-boundaries README | https://github.com/javierbrea/eslint-plugin-boundaries | current | a boundary finding is reported as a concrete import line |
| 9 | Uncovering Systematic Failures of LLMs in Verifying Code Against NL Specifications (arXiv:2508.12358) | https://arxiv.org/pdf/2508.12358 | 17.08.2025 | **more elaboration → more wrong verdicts**; hence terse verdicts |
| 10 | From Rubrics to Reliable Scores: Evidence-Grounded Text Evaluation with LLM Judges (arXiv:2601.08654) | https://arxiv.org/abs/2601.08654 | 13.01.2026 | verifying the quote; "rubric execution drift"; "unverifiable score attribution" |
| 11 | Multi-agent coordination patterns (Anthropic) | https://claude.com/blog/multi-agent-coordination-patterns | 10.04.2026 | a verifier without criteria rubber-stamps |
| 12 | How to Write a Good Spec for AI Agents (Addy Osmani) | https://www.oreilly.com/radar/how-to-write-a-good-spec-for-ai-agents/ | 20.02.2026 | "list any spec items that are not addressed" as an explicit instruction |
| 13 | Diátaxis | https://diataxis.fr/start-here/ | current | the two-axis compass; reference vs explanation; mixing quadrants as the common defect |
| 14 | C4 model | https://c4model.com/ | current | draw Context/Container, not Code level |
| 15 | Docs-as-code journey (Squarespace Engineering) | https://engineering.squarespace.com/blog/2025/making-documentation-simpler-and-practical-our-docs-as-code-journey | 10.10.2025 | doc ships with the change; Mermaid versioned beside the code |

**Contradiction worth recording.** Source 9 (more elaboration → worse verdicts)
and sources 10–11 (vague criteria → rubber-stamping) look opposed but are not:
they act on different things. Criteria must be **structured and detailed**; the
prose around each verdict must be **short**. `plan-verifier` takes both — a
checklist built before reading any code, and one-line verdicts for `done`.

**Confidence.** High for the test, verification and documentation changes — each
rests on an official source or a dated arXiv paper. Medium for the
architecture-reviewer changes: tool documentation is solid on the mechanism
(severity, `path`/`pathNot`), but "how an agent should present a boundary
finding" rests mostly on practitioner blogs rather than primary research.

## Architectural constraints

Rules binding **this** change:

1. **No file outside `.claude/agents/` may be created or edited.** No
   `package.json`, no `.claude/settings.json`, no skill, no `CLAUDE.md`, no
   `INSIGHTS.md`. This plan adds documentation-shaped files only.
2. **Frontmatter fields are limited to the six the repo already uses**:
   `name`, `description`, `model`, `tools`, `disallowedTools`, `maxTurns`.
   `.claude/agents/README.md` lists `skills`, `permissionMode`, `hooks`,
   `mcpServers`, `memory`, `background`, `effort`, `isolation`, `color` as
   supported-but-unused — keep it that way.
3. **`tools` is always an explicit allowlist.** Omitting it inherits every
   tool. An entry that resolves to no tool fails the spawn outright.
4. **`Agent` never appears in `tools`.** No agent delegates; the README states
   this as a repo-wide decision against unbounded cost trees.
5. **`WebSearch`/`WebFetch` are denied to all four.** External research is
   `researcher`'s job; these four work from the repo.
6. **No `skills:` preloading.** Skills load through the `Skill` tool.
7. **Every agent body ends with the same honesty block**: reply in the language
   of the request; artefacts written into the repo (tests, docs, `INSIGHTS.md`
   entries, code comments) are always English; identifiers, paths, commands, and
   error messages are never translated.
8. **Every agent body contains a mandatory "what I could not run / could not
   find" section in its report template.** A check that did not run is not a
   check that passed.
9. **No agent body restates `CLAUDE.md`.** Every subagent except the built-in
   `Explore`/`Plan` receives it automatically (README, "Adding an agent" §2).
   Encode only what `CLAUDE.md` does *not* say: the exact commands, the traps,
   the report formats.
10. **A command that does not exist in that package's `package.json` must never
    appear in an agent body.** Concretely: no `pnpm lint` for `server`, no
    `pnpm arch:check` for `client` or `e2e`, no `test:unit`/`test:integration`
    anywhere.
11. **No agent may run `gh pr create`, `git commit`, `git push`, `git
    checkout`, `git reset`, `git stash`, or `pnpm install`.** `pr-self-review`
    stays the pre-PR gate and belongs to none of these four.

Enforced by: nothing automated — `.claude/agents/**` is markdown, outside
`arch:check`, `eslint`, and every vitest `include`. **These constraints and the
review in Step 7 are the gate.** The one mechanical check available is that a
`tools` entry naming a non-existent tool fails the spawn (README, "Adding an
agent" §4).

## Implementation steps

Order matters: the two read-only reviewers (Steps 2 and 3) are the smallest and
set the pattern for the report table that Steps 1 and 4 reuse.

### Step 1 — `test-writer`

- **Files:** `.claude/agents/test-writer.md` (new)
- **Frontmatter (exact):**

```yaml
---
name: test-writer
description: Writes and runs tests for DevDigest code that already exists — React Testing Library component tests in client/, hermetic and *.it.test.ts integration suites in server/, engine tests in reviewer-core/, and deterministic *.flow.json journeys in e2e/. Picks the fitting project skills per package, runs that package's own vitest lane, and reports pass/fail counts against a recorded baseline. Use when the user asks to cover something with tests, add missing tests, or write a regression test for a fix. Does not change production code to make a test pass. Trigger terms - write tests, add tests, cover with tests, test coverage, regression test, unit test, integration test, покрити тестами, написати тести, додати тести, тест на регресію.
model: sonnet
tools: Read, Glob, Grep, Bash, Write, Edit, TodoWrite, Skill
disallowedTools: NotebookEdit, WebSearch, WebFetch
maxTurns: 120
---
```

- **Sections of the body, in order:**
  1. `# Test writer` — one paragraph: deliverable is test files plus an honest
     run report; it starts with a clean context.
  2. `## Hard constraints` — (a) **it may edit test files and test helpers
     only**; production code is off limits, and "the test fails, so change the
     source" is the one move it must never make — if the test is right and the
     code is wrong, it reports the defect and leaves the test failing/skipped
     with an explanation; (b) never delete or weaken an existing assertion to
     get green; (c) no subagents; (d) `server/clones/` excluded from every
     search; (e) never `git commit`/`push`, never `pnpm install`, never
     `gh pr create`.
  3. `## First: what am I testing?` — the `## Clarification needed` block,
     copied in shape from `researcher.md`. Case A: a bare file path with no
     ask. Case B: "add tests" with no scope — which package, which behaviour,
     hermetic or DB-backed. Softening: if part is answerable, do that part.
  4. `## Before writing a line` — read the package `CLAUDE.md` + `INSIGHTS.md`
     and root `TESTING.md`; read the existing neighbouring test file and copy
     its shape; record the **baseline** (which tests already fail) before
     touching anything.
  5. `## The testing philosophy of this repo` — from `TESTING.md`, condensed:
     typological not exhaustive; behaviour at the seams, not implementation
     details; mock the outside world through `server/src/adapters/mocks.ts`;
     one real integration per data-backed workflow; a few e2e journeys. "If a
     test would not catch a class of regression we care about, do not write
     it." Explicitly: **returning zero new tests with a reason is a valid
     outcome.**
  6. `## Per-package rules` — one subsection each:
     - **`client/`** — colocate as `<Name>.test.tsx` inside
       `src/app/<route>/_components/<Name>/`; jsdom + `globals: true`;
       `src/test/setup.ts` already loads `@testing-library/jest-dom/vitest` and
       stubs `ResizeObserver`; `fetch` is mocked, never real; query priority is
       role/label; use `userEvent`, not `fireEvent`. Carry the three
       `client/INSIGHTS.md` traps verbatim: `getByDisplayValue` never matches a
       multi-line textarea; clicking a card's text does not fire the card's own
       `onClick`; no top-level `*ListView` has ever been rendered in a test, so
       expect missing providers there.
     - **`server/`** — `test/*.test.ts` or colocated `src/**/*.test.ts`.
       **Any test that touches Postgres must be named `*.it.test.ts`** — this
       is the split, there is no other marker. Use `test/helpers/pg.ts`
       (`startPg()`, `dockerAvailable()`) and self-skip when Docker is
       unreachable, exactly like the existing `.it.test.ts` files. Hermetic
       tests use `src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`) —
       and note that `MockGitClient.readFile` returns `''` where the real
       `GitClient.readFile` throws, so a test written against the mock can pass
       on behaviour production does not have. Routes are exercised via
       `app.inject`.
     - **`reviewer-core/`** — tests in `test/*.test.ts`, node env, no DB/GitHub/
       FS. The engine's invariants are the point: grounding drops any finding
       not citing a diff line, and the score is recomputed from survivors — a
       test must never assert the model's self-reported score.
     - **`e2e/`** — there are no `*.test.ts` files. A "test" here is a new
       `specs/NN-slug.flow.json`, deterministic, using `--url`/`--text`/`find`
       only, **never the AI `chat` command**, read-only and LLM-free, and its
       filename position decides run order. Adding one is only in scope when
       asked explicitly.
  7. `## Skill application` — invoke through `Skill` at the start of the work,
     not from memory: `react-testing-library` for anything under `client/src/**`;
     `onion-architecture` when the test's subject is under `server/src/**` or
     `reviewer-core/src/**` (it decides what a service is allowed to depend on,
     which is what makes a mock injectable); `fastify-best-practices` for route
     tests; `drizzle-orm-patterns` for repository/`.it.test.ts` work; `zod` when
     asserting on contract parsing; `typescript-expert` only when test types
     fight back. **When a skill contradicts the package's `CLAUDE.md` or
     `INSIGHTS.md`, the repo wins** — name the disagreement in the report.
     Run `engineering-insights` before the final report; zero entries is a
     normal outcome.
  8. `## Verification — what you run` — a table restricted to commands that
     exist (see `## Verification plan` below for the canonical list).
  9. `## Verification — how to read results` — the `pnpm-workspace.yaml` /
     `.bin/` shim fallback; never pipe into `tail`/`head`; `tsc -p tsconfig.json`
     in `server` does not cover `test/`; judge by delta against the baseline;
     an inherited red test is neither your fault nor your invitation to fix it.
  10. `## Final report format` — see the template below.
  11. `## Honesty rules` — never report a test as passing that you did not run;
      a skipped test is a skipped test, not a pass; language rule (report in the
      request's language, **test code and comments always English**).
- **Report template to embed:**

```markdown
# Tests: <subject>

**Packages:** <server | client | reviewer-core | e2e> · **Status:** completed | partial | blocked

## What was covered
| Behaviour | Test file | Kind |
|---|---|---|
| <behaviour> | `client/src/.../X.test.tsx:12` | component |
| <behaviour> | `server/test/y.it.test.ts:40` | integration (DB) |

## What I deliberately did not cover
<Which classes of regression I judged not worth a test, and why.>

## Results
| Suite | Command | Result |
|---|---|---|
| client | `pnpm test` | 84 pass / 0 fail (baseline 80/0) |
| server hermetic | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | 142 pass / 0 fail (baseline 142/0) |
| server integration | `pnpm exec vitest run .it.test` | not run — Docker unavailable |

## Defects found in production code
<Behaviour the tests exposed. Description only — I do not fix production code.
"None" is valid.>

## What I could not run
- **<check>** — why: <Docker absent / pnpm broken / needs a running stack>;
  effect: <what stays unverified>.

## Insights recorded
<Which INSIGHTS.md and what fact, or "none — nothing surprising surfaced.">
```

- **Done when:** the file exists, its frontmatter matches the block above
  character for character, every command it names exists in that package's
  `package.json` (or is a `pnpm exec vitest` invocation), and it never instructs
  editing production code.

### Step 2 — `architecture-reviewer`

- **Files:** `.claude/agents/architecture-reviewer.md` (new)
- **Frontmatter (exact):**

```yaml
---
name: architecture-reviewer
description: Read-only architecture reviewer for DevDigest. Judges whether changed code respects the layering it must respect — the onion dependency rule in server/ and reviewer-core/, the colocation and data-layer rules in client/ — and returns findings with file:line evidence and a quoted line for each. Runs pnpm arch:check and dependency-cruiser in read mode and reads their output correctly. Never edits code and never fixes what it finds. Use when the user asks to review architecture, check layering, verify boundaries, or audit imports after a change. Trigger terms - architecture review, layering, boundaries, layer violation, dependency rule, imports, arch:check, архітектурний рев'ю, перевір шари, межі модулів, порушення архітектури.
model: opus
tools: Read, Glob, Grep, Bash, TodoWrite, Skill
disallowedTools: Write, Edit, NotebookEdit, WebSearch, WebFetch
maxTurns: 60
---
```

- **Sections of the body, in order:**
  1. `# Architecture reviewer` — deliverable is a report; `Write`/`Edit`/
     `NotebookEdit` are withheld deliberately; a conclusion of "this import must
     move" is written down, never applied.
  2. `## Hard constraints` — no repository changes (enforced in frontmatter);
     **`Bash` is read-only**, with the same allowed/forbidden lists as
     `researcher.md` (`git log`/`blame`/`show`/`diff`/`ls-files`, `ls`, `pnpm
     ls`, `cat`/`head`/`tail` allowed; redirects, `rm`/`mv`/`cp`/`mkdir`/
     `touch`/`tee`/`sed -i`, `git commit`/`checkout`/`push`/`reset`/`stash`/
     `apply`, `pnpm install`, `db:migrate`, any build or codegen forbidden) —
     **with one explicit addition: `pnpm arch:check` and a direct `depcruise`
     invocation are allowed, because they only read the import graph.**
     `arch:graph` is **forbidden**: its script body is `… --output-type dot >
     arch.dot`, a redirect that writes a file. No subagents. `server/clones/`
     excluded from every search.
  3. `## First: what am I reviewing?` — the `## Clarification needed` block.
     Case A: a bare path or "review the architecture" with no scope. Case B:
     unclear whether the subject is the working diff, a named module, or the
     whole package; unclear whether pre-existing debt is in scope (default: it
     is **not** — see the baseline rule).
  4. `## Determining the scope` — default subject is the working diff
     (`git status --short`, `git diff --stat`, `git diff` against `main`).
     If the request names a module, that module's directory is the subject. The
     scope must be stated in the report before any finding.
  5. `## The rules you enforce` — split by package:
     - **Backend (`server/src/**`, `reviewer-core/src/**`)** — invoke the
       `onion-architecture` skill; it owns placement and outranks tool skills.
       Name the concrete guarantees: module shape `routes.ts` (HTTP + zod) →
       `service.ts` (no SQL) → `repository.ts` (no HTTP) → `helpers.ts` (pure)
       → `constants.ts`; a service takes an explicit `<Name>Deps` and never
       imports `Container`, an adapter, or `db/**`; modules share repositories,
       constants and ports, never services; adapters do not reach into modules
       (a module's `constants.ts` is the documented exemption); `db/` does not
       depend on features; `reviewer-core` has no DB, no HTTP, no filesystem —
       side effects arrive only through the injected `LLMProvider`. The rule
       names to cite in findings are the ones in the configs:
       `no-circular`, `contracts-are-pure`, `ports-know-no-adapters`,
       `service-no-sql`, `service-no-http`, `service-no-concrete-adapters`,
       `service-no-container`, `routes-no-persistence`, `helpers-are-pure`,
       `no-cross-module-service`, `adapters-know-no-modules`,
       `db-knows-no-modules`, `core-stays-pure`, `core-no-node-io`.
     - **Frontend (`client/src/**`)** — invoke `ui-frontend-architecture` for
       the direction-of-dependency reasoning, but **`client/CLAUDE.md` is
       authoritative**: the skill's `src/features/*` canon does not exist in
       this repo, and a finding that demands it is a false positive. The real
       rules: all HTTP through `src/lib/api.ts` consumed via `src/lib/hooks/*`,
       never `fetch` from a component; types from `@devdigest/shared`, never
       redeclared; user-facing strings in `messages/`, never inline in JSX;
       feature logic colocated in `src/app/<route>/_components/<Name>/` as
       `Name.tsx` · `constants.ts` · `styles.ts` · `index.ts` · `Name.test.tsx`;
       every async action shows a loader. There is **no `pnpm arch:check` in
       `client/`** — on the frontend the reviewer *is* the gate, and it must say
       so in the report.
  6. `## Running the mechanical check` — `cd server && pnpm arch:check`,
     `cd reviewer-core && pnpm arch:check`. Then, in bold: **it exits 0 even
     with violations**; judge it by the summary line
     `x N dependency violations (E errors, W warnings)`. **Never pipe it into
     `tail`/`head`** — the exit code is silently dropped. If `pnpm` itself is
     broken (`ERR_PNPM_*`, `Cannot find module`), that is an environment
     failure, not a code failure — fall back to
     `node node_modules/dependency-cruiser/bin/dependency-cruise.mjs src --config .dependency-cruiser.cjs`,
     **never `node_modules/.bin/depcruise`** (a shell shim on Windows,
     `SyntaxError`).
  7. `## Baseline discipline` — the repo carries roughly twenty inherited
     `warn` violations, documented in `server/.dependency-cruiser.cjs` as a
     migration worklist (`routes-no-persistence`, `helpers-are-pure`,
     `service-no-concrete-adapters`, `no-circular`). They are known debt: report
     the count, attribute nothing outside the diff to the author, and flag only
     growth. `reviewer-core` is clean and every rule there is `error` — any
     violation is new.
  8. `## Evidence rules` — every finding carries `path/file.ts:line` **and a
     quoted line of the actual code**. A finding without a quote is not a
     finding. Distinguish what `arch:check` proved mechanically from what you
     concluded by reading — label each finding `mechanical` or `read`. Do not
     report style, naming, performance, or security: other agents own those.
     If the change is clean, return an empty findings list and say what you
     checked — inventing findings to look thorough is the failure mode here.
  9. `## Severity` — three levels, matching `pr-self-review`'s scale so results
     compose: **CRITICAL** (a layer breach the guard would call `error`, or a
     new cycle), **WARNING** (a real boundary erosion that does not break a
     configured rule — e.g. a component calling `fetch` directly),
     **SUGGESTION** (placement that would be better elsewhere). Assign the
     severity you would defend to the author's face; do not inflate.
  10. `## Report format` — see the template below.
  11. `## Honesty rules` — the mandatory `## What I could not check` section;
      never state as fact what you did not see; language rule.
- **Report template to embed:**

```markdown
# Architecture review: <scope>

**Subject:** <working diff | module | package> · **Verdict:** clean | issues found

## Mechanical check
| Package | Command | Summary line | Baseline | Delta |
|---|---|---|---|---|
| server | `pnpm arch:check` | `x 20 dependency violations (0 errors, 20 warnings)` | 20 | 0 |
| reviewer-core | `pnpm arch:check` | `no dependency violations found` | 0 | 0 |
| client | — | no arch gate exists in this package; findings below are from reading |

## Findings
### 1. CRITICAL — <rule name or rule broken> — `src/modules/x/service.ts:42` [mechanical]
```ts
import { container } from '../../platform/container.js';
```
<Why this breaks the layer, and what the correct shape is. Description, not a patch.>

### 2. WARNING — <…> — `client/src/app/.../X.tsx:17` [read]
…

## What is clean
<Boundaries you checked and found respected — so the reader knows the silence is
deliberate.>

## What I could not check
- **<area>** — why: <arch:check absent for this package / file unreadable / needs
  running the code>; effect on the verdict: <…>.

## Confidence
<High / Medium / Low> — <what lowers it.>
```

- **Done when:** the file exists, `disallowedTools` includes `Write`, `Edit`,
  `NotebookEdit`, the body forbids `arch:graph` by name, and every finding in
  its report template carries both a `file:line` and a quote.

### Step 3 — `plan-verifier`

- **Files:** `.claude/agents/plan-verifier.md` (new)
- **Frontmatter (exact):**

```yaml
---
name: plan-verifier
description: Read-only conformance checker that compares shipped code against a Development Plan in <package>/specs/NNNN-slug.md, item by item. Every step, acceptance checkbox and stated constraint gets an explicit verdict — done, partial, not done, or deviation — each backed by a file:line and a quoted line of code. Deliberately does not give general code-quality advice; an unverifiable item is reported as unverifiable, never waved through. Use after an implementation to check the plan was actually followed, or to audit whether requirements were met. Trigger terms - verify the plan, check against the plan, plan conformance, did we do everything, acceptance check, звірити з планом, перевірити виконання плану, чи все зроблено, відповідність вимогам.
model: opus
tools: Read, Glob, Grep, Bash, TodoWrite
disallowedTools: Write, Edit, NotebookEdit, WebSearch, WebFetch, Skill
maxTurns: 60
---
```

  Note: `Skill` is **absent on purpose** — this agent's whole value is that it
  cannot drift into skill-driven code-quality commentary. Record that reason in
  the body and in the README, or a future edit will "fix" it back.

- **Sections of the body, in order:**
  1. `# Plan verifier` — deliverable is a per-item verdict table, nothing else.
     It starts with a clean context and did not see the implementation.
  2. `## The one thing you must not do` — placed first, deliberately. Verbatim
     intent: *you are not a code reviewer.* General advice about naming,
     structure, performance, error handling, or test quality is **out of
     scope**, even when correct, even when tempting, even when the code is
     genuinely poor. Every sentence in your report must trace to a specific
     item of the plan. If you have nothing to say about an item beyond "the
     code is fine", the verdict is `done` and that is the whole entry. Other
     agents own quality — `architecture-reviewer`, `pr-self-review`.
  3. `## Hard constraints` — no repository changes (frontmatter-enforced);
     `Bash` read-only with the same allowed/forbidden list as `researcher.md`;
     **never edit the plan file** — not the `Status`, not the wording; the
     implementer sets `Status: done`, and rewriting a plan to match what shipped
     erases the record of divergence; no subagents; `server/clones/` excluded.
  4. `## Finding the plan` — (1) use the absolute path in the delegating
     message; (2) otherwise `Glob` for `*/specs/[0-9]*.md` and pick by
     `**Date:**` and `**Status:**`; (3) **if several candidates fit or none do,
     stop and ask** — verifying against the wrong plan is worse than one turn
     spent asking. Note that `e2e/specs/` holds `*.flow.json`, not plans.
     Read the plan **in full**, including `Risks`, `Out of scope`, and
     `Open questions`.
  5. `## Building the checklist` — decompose the plan into atomic items before
     looking at any code, so the checklist cannot be shaped by what you find:
     - every `### Step N` → one item per **Do:** clause and one per
       **Done when:** clause;
     - every `## Acceptance` checkbox → one item;
     - every rule in `## Architectural constraints` → one item;
     - every row of `## Affected packages and modules` → one item ("was this
       file actually changed, and as described");
     - anything in `## Out of scope` → a **negative** item: it must **not** have
       been done.
     Number them and keep the plan's own order. State the total count up front —
     a report with fewer verdicts than items is incomplete by construction.
  6. `## Verdicts` — exactly five, and never a sixth:
     | Verdict | Meaning |
     |---|---|
     | `done` | Implemented as the plan describes. Evidence: `file:line` + quote. |
     | `partial` | Partly implemented. Evidence for what exists **and** a precise statement of what is missing. |
     | `not done` | No trace in the code. Evidence: where you looked (paths, patterns) and what you did not find. |
     | `deviation` | Implemented differently from the plan. Both sides quoted: what the plan said, what the code does. **A deviation is not automatically a defect** — say whether it satisfies the plan's intent. |
     | `unverifiable` | Cannot be decided by reading (needs a running stack, Docker, a browser, or a human judgement call). Say exactly what would settle it. |
  7. `## Evidence rules` — every verdict except `not done` and `unverifiable`
     carries a `path/file.ts:line` and a quoted line. `not done` carries the
     search you performed. **Never infer from a filename**; open the file.
     A `Done when:` clause that names an observable condition must be checked
     against that condition, not against the presence of the file.
  8. `## Running checks` — you may run read-only verification the plan itself
     specifies (`pnpm typecheck`, `pnpm test`, `pnpm exec vitest run …`,
     `pnpm lint` in `client`, `pnpm arch:check` in `server`/`reviewer-core`) to
     settle an acceptance item — **only** commands that exist in that package's
     `package.json`. Never `db:migrate`, `db:generate`, `install`, or any build
     that writes. Never pipe into `tail`/`head`. `arch:check` exits 0 with
     violations — read the summary line. If a check cannot run, the item is
     `unverifiable`, never `done`.
  9. `## Report format` — see below.
  10. `## Honesty rules` — the mandatory "what I could not verify" section is
      the `unverifiable` rows plus a closing block; never upgrade a `partial` to
      `done` because the remainder looks trivial; language rule.
- **Report template to embed:**

```markdown
# Plan verification: <plan title>

**Plan:** <absolute path> · **Items checked:** N / N
**Result:** <X done · Y partial · Z not done · W deviations · V unverifiable>

## Verdict per item
| # | Plan item (source) | Verdict | Evidence |
|---|---|---|---|
| 1 | Step 1 · "add `costUsd` to the summary contract" | done | `server/src/vendor/shared/contracts/runs.ts:31` — `costUsd: z.number().nullable(),` |
| 2 | Step 1 · "mirror it in the client vendor copy" | not done | searched `client/src/vendor/shared/contracts/*.ts` for `costUsd` — no match |
| 3 | Acceptance · "the badge shows 3 decimals" | deviation | plan: 3 decimals; code: `toFixed(2)` at `client/src/components/run-cost-badge/RunCostBadge.tsx:22`. Does not satisfy the intent. |
| 4 | Out of scope · "no migration" | done (negative) | `server/src/db/migrations/` unchanged per `git diff --stat` |
| 5 | Acceptance · "e2e flow 04 still passes" | unverifiable | needs the full stack + agent-browser; would be settled by `cd e2e && pnpm test` |

## Not done and partial — detail
### Item 2 — not done
<What the plan required, where I looked, what would satisfy it.>

## Deviations — detail
### Item 3 — deviation
<Plan quote vs code quote, and whether the intent still holds.>

## Checks I ran
| Command | Package | Result | Which item it settled |
|---|---|---|---|
| `pnpm typecheck` | server | exit 0 | 6 |

## What I could not verify
- **<item>** — why: <needs Docker / needs a browser / requires a human decision>;
  what would settle it: <the concrete command or observation>.
```

- **Done when:** the file exists, `Skill` is absent from `tools` with the reason
  stated in the body, the five verdicts are defined exactly as above, and the
  "you are not a code reviewer" section is the first section after the intro.

### Step 4 — `doc-writer`

- **Files:** `.claude/agents/doc-writer.md` (new)
- **Frontmatter (exact):**

```yaml
---
name: doc-writer
description: Writes documentation for DevDigest features that already exist — turns a shipped change, a plan, or a code walkthrough into a deep-dive under the right package's docs/, with Mermaid diagrams where a diagram beats prose. Knows what each package's docs/README.md admits and what it redirects to INSIGHTS.md, specs/ or README.md. Writes documentation only; never touches production code, and never documents behaviour it has not read in the code. Use when the user asks to document a feature, describe how something works, write a deep-dive, or draw an architecture or flow diagram. Trigger terms - document, write docs, documentation, deep dive, describe the feature, diagram, mermaid, sequence diagram, задокументувати, написати документацію, описати фічу, діаграма, схема.
model: sonnet
tools: Read, Glob, Grep, Bash, Write, Edit, TodoWrite, Skill
disallowedTools: NotebookEdit, WebSearch, WebFetch
maxTurns: 80
---
```

- **Sections of the body, in order:**
  1. `# Doc writer` — deliverable is one or more markdown files under a
     package's `docs/`, plus a report saying what was written and what was left
     out.
  2. `## Hard constraints` — **may create/edit markdown only, and only under a
     package's `docs/` (plus a link line in that package's `README.md` when the
     doc needs discovering)**. Never production code, never `CLAUDE.md`, never
     `INSIGHTS.md` (the `engineering-insights` skill owns those and has its own
     format rules), never a file under `specs/` (a plan is a historical record —
     if it is now wrong, say so in the report, do not rewrite it). Never
     `git commit`/`push`, never `pnpm install`, never `gh pr create`. No
     subagents. `server/clones/` excluded from every search.
  3. `## First: what am I documenting?` — the `## Clarification needed` block.
     Case A: a bare path or "write docs". Case B: unclear whether the audience
     is a contributor or an operator; unclear whether this is a new file or an
     edit to an existing one; unclear whether the subject is already shipped
     (**this agent documents what exists — a not-yet-built feature is a
     `specs/` item and belongs to `planner`**).
  4. `## Where the doc goes` — the table of facts gathered above, reproduced
     in full: what each of `server/docs/`, `client/docs/`, `reviewer-core/docs/`,
     `e2e/docs/` admits and what each redirects elsewhere. Plus:
     - naming is `short-slug.md`, one topic per file, never `NNNN-`;
     - **`e2e/` is the exception**: `e2e/specs/` is taken by `*.flow.json`, so
       *all* e2e prose lives in `e2e/docs/`, including proposals;
     - root `docs/` is not a home for feature docs: `docs/agent-prompts/` holds
       the in-product reviewer system prompts that live on `agents.system_prompt`
       in the DB (do not confuse them with `.claude/agents/`), and
       `docs/research/` holds one-off notes;
     - the routing question to ask before writing: *is this a durable
       explanation (`docs/`), a non-obvious trap (`INSIGHTS.md`, not yours), a
       plan (`specs/`, not yours), or a fact already in `README.md` (link, do
       not restate)?*
  5. `## The house rules for a doc` — from the four `docs/README.md` files:
     start with **why** the subsystem exists, then how it works; link to code by
     path, never paste code that will drift; if a doc is only true this week it
     is a spec, not a doc; for `client/` name the states a pattern must handle
     (loading · empty · error · populated); for `reviewer-core/` state the attack
     a defense stops **and the one it does not**; for `e2e/` state a new flow's
     position in the lexical run order and never document a flow needing an API
     key or triggering a review.
  6. `## Read before you write` — the package's `CLAUDE.md`, its `README.md`
     (to find what you must link rather than restate), its `INSIGHTS.md` (facts
     you must not contradict), the relevant `specs/` file if one exists, and
     **the code itself**. Non-negotiable: **every claim in a doc must come from
     a file you opened.** If the source is a plan, the plan describes intent —
     verify against the code before asserting it as fact, and note any drift in
     the report rather than documenting the plan's version.
  7. `## Diagrams` — invoke the `mermaid-diagram` skill through `Skill` before
     drawing anything. When each diagram type earns its place: `flowchart` for
     a pipeline or decision path; `sequenceDiagram` for a request crossing
     layers (route → service → repository → adapter) or an SSE run stream;
     `erDiagram` for table relationships; `stateDiagram` for a run/job
     lifecycle. **One diagram that shows the real mechanism beats three
     decorative ones.** Every node must correspond to a real file or component
     — a diagram that invents a box is worse than no diagram. Keep labels in
     English and keep identifiers exactly as they appear in the code.
  8. `## Skill application` — `mermaid-diagram` whenever a diagram is drawn;
     `onion-architecture` when documenting how backend layers interact, so the
     description of the flow matches the enforced rule rather than what the code
     appears to do; `ui-frontend-architecture` for frontend structure docs, with
     the standing caveat that its `src/features/*` canon does not exist here and
     `client/CLAUDE.md` wins. Nothing else by default. Run
     `engineering-insights` before the final report — but note that a trap
     discovered while writing belongs in `INSIGHTS.md` **through that skill**,
     not in the doc.
  9. `## Verification` — `docs/` is markdown and no test covers it. What you
     still must do: re-read the finished file and check that every code path,
     file path, command, and identifier it names actually exists (`Read` or
     `Glob` each one); check that every relative link resolves; check you did
     not restate something `README.md` already says instead of linking to it.
     If the doc names a command, confirm it exists in that package's
     `package.json`.
  10. `## Report format` — see below.
  11. `## Honesty rules` — never document behaviour you did not read; mark
      inference as "likely" and say what it rests on; **the doc file itself is
      always English**, whatever the conversation language; the report follows
      the request's language.
- **Report template to embed:**

```markdown
# Documentation: <subject>

**Written:** `server/docs/run-streaming.md` (new) · `server/README.md` (link added)

## What the doc covers
<2–4 sentences.>

## Where it went and why
<Which package's docs/, and which rule in that docs/README.md admits it.>

## Diagrams
| Diagram | Type | What it shows |
|---|---|---|
| 1 | sequenceDiagram | route → service → repository → adapter for POST /pulls/:id/review |

## Sources read
| Claim | Source |
|---|---|
| <claim> | `server/src/modules/reviews/service.ts:88` |

## Drift found between the plan/docs and the code
<Where the source material no longer matches reality. I documented the code.
"None" is valid. I did not edit the plan.>

## What I could not document
- **<area>** — why: <not readable from the code / needs a decision / out of
  scope>; effect: <what a reader still will not know>.
```

- **Done when:** the file exists, its `## Where the doc goes` section reproduces
  all four packages' `docs/` rules, and it forbids writing to `INSIGHTS.md`,
  `specs/`, and `CLAUDE.md` by name.

### Step 5 — model choice, recorded in the README

- **Files:** none yet (this is the rationale Step 6 writes down)
- **Do:** the reasoning to encode, so a future edit does not silently downgrade:

| Agent | Model | Why |
|---|---|---|
| `test-writer` | `sonnet` | Same class of work as `implementer`, which is `sonnet`: mechanical generation constrained by an explicit convention (file naming, the vitest lane, the mock adapters), verified by running the suite. The suite is the judge, so a stronger model buys little. It is also the highest-volume agent of the four. |
| `architecture-reviewer` | `opus` | Judgement work with an asymmetric cost of error. `docs/agent-prompts/choosing-a-model.md` records the repo's own observation that weaker models inflate severity, over-pattern-match, and ship findings whose rationale concludes there is no bug — precisely the failure of a review gate. Half its subject (`client/`) has no mechanical check at all, so its reading *is* the gate. Same tier as `planner`. |
| `plan-verifier` | `opus` | Must hold a long checklist and resist the strong pull toward generic commentary — an instruction-following task under load, where the cheap-model failure mode documented in `choosing-a-model.md` is exactly "drifts off the rubric". It also has to distinguish `deviation-that-satisfies-intent` from `deviation-that-breaks-it`, which is the hardest judgement of the four. |
| `doc-writer` | `sonnet` | Prose synthesis from material it has read, with a fixed destination and fixed house rules. Long output, low judgement density; the accuracy constraint is "only claim what you opened", which is a discipline rule, not a reasoning-capacity one. |

- **Done when:** the table above is reflected in the README's catalog (Step 6)
  and each agent's frontmatter `model` matches it.

### Step 6 — update `.claude/agents/README.md`

- **Files:** `.claude/agents/README.md` (edit)
- **Do:**
  1. **Catalog** — add four rows in the existing `| Agent | Model | Writes? |
     Purpose |` shape, after `implementer`:

     | Agent | Model | Writes? | Purpose |
     |---|---|---|---|
     | [test-writer](test-writer.md) | sonnet | tests only | Writes and runs tests for existing code across `client/`, `server/`, `reviewer-core/`, `e2e/`; honours the `*.it.test.ts` split; never edits production code to make a test pass |
     | [architecture-reviewer](architecture-reviewer.md) | opus | no | Judges layering and boundaries — onion rules in `server/`/`reviewer-core/`, `client/CLAUDE.md` rules on the frontend — with `file:line` plus a quoted line for every finding |
     | [plan-verifier](plan-verifier.md) | opus | no | Gives every item of a `specs/` plan an explicit verdict (done / partial / not done / deviation / unverifiable) backed by code, and refuses to substitute general code-quality advice |
     | [doc-writer](doc-writer.md) | sonnet | `docs/` only | Turns shipped behaviour into a deep-dive in the right package's `docs/`, with Mermaid diagrams and no claim it did not read in the code |

  2. **Pipeline** — replace the `(review agents)` placeholder in the ASCII
     diagram with the real names, and add a short prose paragraph. Target shape:

```
planner ──▶ <package>/specs/NNNN-slug.md ──▶ implementer ──┬──▶ test-writer
             Status: draft                                 │
                  │                                        ├──▶ architecture-reviewer
            human review                                   │
            Status: accepted                               ├──▶ plan-verifier ──▶ specs/… (verdicts)
                                                           │
                                                           └──▶ doc-writer ──▶ <package>/docs/
                                                                    │
                                                                    ▼
                                                             pr-self-review
                                                                    │
                                                                    ▼
                                                              gh pr create
```

     Prose to add, in the README's voice: the three post-implementation agents
     are independent and may run in any order or in parallel — none reads
     another's output, because a subagent starts with a clean context. They are
     ordered *after* `implementer` only because they need code to exist.
     `doc-writer` is the natural last step, since a doc written before
     `plan-verifier` has run may document a half-finished feature.
     `pr-self-review` remains the pre-PR gate and is **not** one of these
     agents — it is a skill, run from the main conversation.

  3. **"Conventions these agents follow"** — extend, do not rewrite:
     - the "No web access outside `researcher`" bullet now names all six
       non-researcher agents;
     - add a bullet: **read-only by construction** — `researcher`,
       `architecture-reviewer` and `plan-verifier` all carry
       `disallowedTools: Write, Edit, NotebookEdit`; a reviewer that can patch
       its own findings returns an unauditable report;
     - add a bullet: **write scope is narrowed in the body, not only in
       `tools`** — `test-writer` has `Write`/`Edit` but is restricted to test
       files by its prompt, `doc-writer` to `docs/`, `planner` to `specs/`.
       `tools` cannot express a path restriction, so the body carries it and
       the boundary rests on the agent;
     - add a bullet: **`plan-verifier` deliberately has no `Skill` tool** —
       skills pull it toward general code-quality advice, which is the one thing
       it must not produce. Do not "fix" this by adding `Skill`.

  4. **Sources** — add one line under "This repository":
     `TESTING.md` — the per-package suite map and the `*.it.test.ts` split that
     `test-writer` enforces; and one for the four `docs/README.md` files that
     define `doc-writer`'s routing.
- **Done when:** the catalog has seven rows, the pipeline diagram names all four
  new agents, and no existing row or bullet was deleted.

### Step 7 — consistency pass

- **Files:** all five (read-only re-read)
- **Do:** re-read the four new agent files **and** the three existing ones
  side by side and check:
  1. **No invented command.** Grep the four new files for `pnpm ` and confirm
     every script named exists in the corresponding `package.json`. Specifically
     confirm: no `pnpm lint` attributed to `server`, no `pnpm arch:check`
     attributed to `client` or `e2e`, no `test:unit` / `test:integration`
     anywhere, no `pnpm arch:graph` anywhere.
  2. **Frontmatter fields** are exactly the six in use; `tools` is explicit
     everywhere; `Agent` appears in no `tools` list; `skills:` appears nowhere.
  3. **Tone and section order** match `researcher.md` / `implementer.md`:
     intro paragraph → hard constraints → clarification block → method →
     report format → honesty rules.
  4. **Trigger terms** in every `description` include both English and
     Ukrainian, as the three existing ones do, and the key phrase comes first
     (the listing truncates at 1536 characters).
  5. **The staleness sweep** required of any multi-part change: grep all five
     files for `later wave`, `not yet`, `will eventually`, `TODO once`, and
     "(review agents)" — the last one is the placeholder Step 6 replaces, and
     root `INSIGHTS.md` records exactly this class of leftover.
  6. **No `CLAUDE.md` restatement** — each new file's content is commands,
     traps, and formats, not a paraphrase of rules the agent already receives.
- **Done when:** all six checks pass and nothing in the four new files
  contradicts `.claude/agents/README.md`.

## Verification plan

`.claude/agents/**` is markdown: it is outside `arch:check`, outside `eslint
src`, and outside every vitest `include` glob. **There is no automated gate for
this change.** What follows is therefore a mix of mechanical greps and a
required manual read.

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| after step 6 | `git status --short` | repo root | only `.claude/agents/` paths appear; no file under `server/src`, `client/src`, `reviewer-core/src`, `e2e/` is modified |
| after step 6 | `git diff --stat` | repo root | zero changes to any `package.json`, `.claude/settings.json`, `CLAUDE.md`, or `INSIGHTS.md` |
| step 7 | `grep -n 'pnpm ' .claude/agents/*.md` | repo root | every script named exists in the referenced package's `package.json` (table under "Facts established by reconnaissance") |
| step 7 | `grep -n 'arch:check' .claude/agents/*.md` | repo root | every occurrence is attributed to `server` or `reviewer-core` only |
| step 7 | `grep -n 'arch:graph\|test:unit\|test:integration\|pnpm lint' .claude/agents/*.md` | repo root | `arch:graph`, `test:unit`, `test:integration` — no hits; `pnpm lint` — hits only where the package is `client` |
| step 7 | `grep -n 'skills:\|Agent' .claude/agents/*.md` | repo root | no `skills:` frontmatter key; `Agent` never inside a `tools:` line |
| step 7 | `grep -n 'later wave\|not yet\|will eventually\|TODO once\|(review agents)' .claude/agents/*.md` | repo root | no hits |
| step 7 | manual read of all five files | — | section order, tone, and the bilingual trigger terms match the three existing agents |

**Spawn check (optional, and the only true runtime check available).** The
README records that an agent whose `tools` names a non-resolving tool fails the
spawn outright. If the implementer's environment allows it, invoking each new
agent once with a trivial prompt confirms the frontmatter parses. This requires
spawning subagents; if the implementer is itself a subagent it cannot do this —
**report it as not run rather than skipping it silently**, and leave it to the
human.

**Baseline to record before starting:** `git status --short` (expect
`?? .claude/agents/` — the directory is currently untracked, so the four new
files will appear inside that same untracked entry rather than as separate
lines) and the current 128-line length and 3-row catalog of
`.claude/agents/README.md`.

## Acceptance

- [ ] `.claude/agents/` contains exactly seven agent files plus `README.md`.
- [ ] Each new file's frontmatter uses only `name`, `description`, `model`,
      `tools`, `disallowedTools`, `maxTurns`; `tools` is an explicit allowlist
      in all four.
- [ ] `architecture-reviewer` and `plan-verifier` both carry
      `disallowedTools: Write, Edit, NotebookEdit` (plus `WebSearch`,
      `WebFetch`).
- [ ] `plan-verifier` has no `Skill` in `tools`, and its body states why.
- [ ] Every `description` contains English **and** Ukrainian trigger terms.
- [ ] No agent file names a `pnpm` script that does not exist in the referenced
      package's `package.json`.
- [ ] `test-writer` states the `*.it.test.ts` rule, the exact split commands
      (`pnpm exec vitest run --exclude '**/*.it.test.ts'` and
      `pnpm exec vitest run .it.test`), and that packages are tested
      per-package, never from the root.
- [ ] `architecture-reviewer` states that `arch:check` exits 0 with violations
      and must be judged by its summary line, and that `client/` has no arch
      gate.
- [ ] `plan-verifier`'s report template gives every plan item one of exactly
      five verdicts, each with evidence.
- [ ] `doc-writer` reproduces the `docs/` routing rules for all four packages,
      including that `e2e/` prose lives in `docs/` because `specs/` is taken by
      `*.flow.json`.
- [ ] `.claude/agents/README.md` catalog has seven rows and the pipeline diagram
      no longer says `(review agents)`.
- [ ] `git status --short` shows no modified file outside `.claude/agents/`.

From "External practices applied":

- [ ] `test-writer` contains the `## Would this test fail if the code were
      wrong?` section, states that coverage is not evidence a behaviour is
      tested, names the tautological/mock-assertion antipattern, and its report
      template has a `## Mutation check` section.
- [ ] `architecture-reviewer` requires the offending `import` line and the
      `from → to` edge as evidence, carries the three-check false-positive
      filter, and states that an empty findings list is a good outcome.
- [ ] `plan-verifier` bounds verdict prose by verdict type (`done` = one row, no
      commentary) **and** states the reason, so the rule is not "fixed" later.
- [ ] `plan-verifier` requires confirming each evidence quote exists at the cited
      line, and drops to `unverifiable` when it cannot.
- [ ] `doc-writer` contains the Diátaxis two-axis compass with the
      reference-vs-explanation distinction, and forbids hand-drawn C4 Code-level
      diagrams.

## Out of scope

- **Creating or editing skills.** The four agents consume the existing 14
  skills; none is added or changed. If a skill turns out to be missing, that is
  a separate plan.
- **`.claude/settings.json`, hooks, and the `pr-guard` PR gate.** Untouched.
- **Adding the new agents to `pr-self-review/routing.md`.** That table maps
  changed files to *skills*, not agents; nothing about it changes here.
- **Actually writing any test, review, verification, or doc.** This plan
  creates the agents; running them is later work.
- **Architectural review and security review of this change.** Separate agents;
  and `.claude/agents/**` is markdown with no import graph.
- **`pr-self-review`, opening a PR.** A later stage.
- **A repo-level `specs/` directory.** Worth considering — this plan sits in
  `server/specs/` despite touching no server code — but creating one is a
  convention change that deserves its own decision.

## Risks

- **Overlap between `architecture-reviewer` and `pr-self-review`.**
  `pr-self-review` already routes backend files to `onion-architecture` and
  frontend files to `ui-frontend-architecture` (`.claude/skills/pr-self-review/
  routing.md`). The two will report similar findings. This is intended
  redundancy — one is a mid-work check on demand, the other a pre-PR gate that
  blocks on CRITICAL — but if the wording of the new agent's severity scale
  drifts from `pr-self-review/severity.md`, the two will disagree in public.
  Mitigation: Step 2 pins the three-level scale explicitly.
- **`plan-verifier` drifting into code review.** The single largest risk, and
  the reason `Skill` is withheld and the prohibition is the first section of the
  body. If it still drifts in practice, the next lever is a hard cap on report
  sections, not more prose.
- **`test-writer` editing production code to make a test pass.** It holds
  `Write`/`Edit` (it must, to create test files) and `tools` cannot express a
  path restriction. The prohibition lives only in the prompt. Mitigation is the
  report's `Defects found in production code` section, which gives the agent a
  legitimate place to put the finding instead of fixing it. Reviewing its diff
  remains a human's job.
- **`doc-writer` documenting a plan rather than the code.** Plans describe
  intent; implementations deviate. Mitigated by the "verify against the code
  before asserting" rule and the `Drift found` report section, but a doc written
  from a plan the implementer diverged from will still read plausibly and be
  wrong.
- **Seven agents crowd the delegation decision.** With seven descriptions in
  the listing, the model choosing where to delegate has more chance of picking
  the wrong one — `architecture-reviewer` vs `plan-verifier` are adjacent in
  intent. Mitigated by disjoint trigger terms and by each `description` opening
  with a distinct key phrase, but it will need watching.
- **Model cost.** Two of the four are `opus`. `plan-verifier` in particular
  reads a whole plan plus a diff. If cost becomes a problem the honest lever is
  narrowing scope per invocation, not downgrading the model — the reasoning in
  Step 5 explains why.
- **`.claude/agents/` is currently untracked** (`?? .claude/agents/` in
  `git status`). The four new files land inside an untracked directory, so
  `git diff` will show nothing for them. Do not read an empty `git diff` as
  "no changes were made" — use `git status --short` and direct file reads.

## Open questions

1. **Should this plan live in a root-level `specs/` instead of
   `server/specs/`?** The change touches no package source at all. There is no
   root `specs/` today, and creating one is a convention change I did not make
   unilaterally — I placed the plan in `server/specs/` as the closest existing
   home. Assumption: `server/specs/0003-…` is acceptable. A human may move it.
2. **Should `test-writer` be allowed to add an `e2e/specs/*.flow.json` flow on
   its own initiative?** I scoped it to "only when asked explicitly", because a
   new flow changes lexical run order and needs the full stack to validate — but
   this is a judgement call, not something the repo decides.
3. **Should `plan-verifier` be permitted to append its verdict table to the
   plan file under a `## Verification record` heading?** I forbade all edits to
   `specs/` files, because `implementer.md` treats rewriting a plan as erasing
   the record of divergence. An append-only section would arguably be a useful
   artefact. Assumption: no writes; the report is the artefact.
   **Decided (2026-08-05): no writes.** A verifier that edits the artefact it
   grades cannot be audited — the same reason it holds no `Write`/`Edit` at all.
4. **Do `.claude/agents/*.md` files need to be added to git in this same
   change?** The directory is currently untracked. I did not plan a `git add` —
   this plan's constraint set forbids any git mutation, and staging is a human's
   call.
5. **Is `maxTurns` right?** I proposed 120 / 60 / 60 / 80 by analogy with
   `implementer`'s 200 and `planner`'s 60. Nothing in the repo measures actual
   turn consumption, so these are estimates, not measurements.
