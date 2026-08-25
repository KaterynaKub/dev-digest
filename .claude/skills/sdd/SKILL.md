---
name: sdd
description: "Runs the Spec-Driven Development execution pipeline against an existing implementation plan — implement, verify coverage, remediate, architecture review, fix review findings, final verification. Accepts a plan path, a spec path, extra requirements as free text, and design images, in any combination. Does NOT write specifications and does NOT write plans: `spec-creator` and `implementation-planner` are run manually, before this. Use when a plan exists and the user asks to execute it end to end. Trigger terms: sdd, implement the plan, run the pipeline, execute the plan, виконати план, запусти пайплайн, реалізуй за планом, прожени SDD."
allowed-tools: Read, Glob, Grep, Bash, Agent, TodoWrite, AskUserQuestion
metadata:
  tags: sdd, orchestration, pipeline, implementation, verification
---

# SDD — execution pipeline

Runs the **execution** half of Spec-Driven Development: a plan exists, and this
skill takes it to verified code. Authoring is deliberately not here.

```
                        ┌─ you ran these manually ─┐
   spec-creator ──▶ SPEC ──▶ implementation-planner ──▶ PLAN
                                                         │
   ══════════════════════ /sdd starts here ══════════════╪══════════════════
                                                         ▼
   1  implementer  (batched, 4–5 steps per call, repeat until plan done)
                                                         │
   2  plan-verifier  pass 1 — coverage: what exists       │
                                                         │
   3  implementer  remediation  ── only if pass 1 found gaps
                                                         │
   4  architecture-reviewer                               │
                                                         │
   5  implementer  remediation  ── max 2 iterations, CRITICAL/WARNING only
                                                         │
   6  plan-verifier  pass 2 — settle what pass 1 left open
                                                         ▼
                                                   final report
```

**You are the orchestrator.** You spawn agents, read their reports, decide what
runs next, and keep the running state. You do **not** write production code
yourself — every edit goes through `implementer`. Your own context stays small:
agents return reports, not transcripts.

## What this skill will not do

- **It does not write or edit specifications.** `spec-creator` owns
  `docs/specs/`, is run manually, and is not invoked from here.
- **It does not write or edit plans.** `implementation-planner` owns
  `.claude/plans/`. If no plan exists, this skill stops and says so — see
  `## Step 0`.
- **It does not write tests.** `test-writer` is deliberately out of the
  pipeline to save tokens. The final report names the criteria left uncovered
  so you can run it manually where it is worth it.
- **It does not open a PR.** The run ends at the final report.
  `pr-self-review` and `gh pr create` stay manual; a hook already gates them.
- **It does not commit.** The tree is left dirty and described.

---

## Step 0 — collect the inputs

Arguments arrive as free text after `/sdd`. Sort whatever you were given into
four buckets — any may be empty, and they may arrive in any order or phrasing:

| Bucket | Looks like | What you do with it |
|---|---|---|
| **Plan** | `.claude/plans/NNNN-*.md`, "план 0007", "the blast-radius plan" | The spine of the run. Resolve to an absolute path. |
| **Spec** | `docs/specs/SPEC-NN-*.md`, "SPEC-03" | Criteria source. Usually already cited by the plan. |
| **Extra requirements** | free prose: "and make the badge amber", "skip the migration" | Constraints that are *not* in the plan. Handle per `## Extra requirements`. |
| **Designs** | image paths, pasted screenshots, `.png`/`.jpg`/`.pdf` | Pass through to the implementer for the UI steps that need them. |

### Resolving the plan

The plan is mandatory — it is what the implementer executes.

1. An explicit path in the arguments wins.
2. Otherwise `Glob .claude/plans/[0-9]*.md`, and prefer `**Status:** accepted`
   over `draft`, then the most recent `**Date:**`.
3. **If several fit, or none do — stop and ask which.** Do not guess: running
   the wrong plan burns an entire implementer pass.
4. **If no plan exists at all**, stop and say so plainly: this skill executes
   plans, it does not create them, and `implementation-planner` is the agent
   that does — run it first. Do not improvise a plan of your own, and do not
   fall back to implementing straight from the spec.

Read the plan yourself before spawning anything. You need four things from it:

- `**Mode:**` — single-agent or multi-agent (N tracks);
- the total **step count**, which sets how many implementer batches to expect;
- `## Requirements` — whether it cites a `docs/specs/SPEC-NN`, which becomes
  the criteria source for both verifier passes;
- `**Touches:**` — which packages are in play, which decides whether
  `architecture-reviewer` has a backend gate to lean on or is reviewing
  `client/` by reading alone.

**If the plan is at `**Status:** draft`**, ask once whether to proceed. A draft
has not passed human review, and code written against one is the most expensive
kind to discard. A plain "так" unblocks the run.

### Extra requirements

Free-text requirements that are not in the plan are the sharp edge of this
command. Sort them before doing anything:

- **A constraint on how a planned step is built** ("use amber, not red";
  "put it behind the existing feature flag") — pass it verbatim to the
  implementer batch that covers that step. Cheap and safe.
- **New scope** — a requirement that adds a step the plan does not have, needs
  a file outside `**Touches:**`, or contradicts a step. **Stop and say so.**
  This is a plan change, and the plan is `implementation-planner`'s to write.
  Offer the two real options: re-run the planner, or run the plan as written
  and handle the addition separately. Do not let the implementer improvise a
  plan extension mid-run — that is exactly the structural divergence its own
  prompt tells it to stop on.

When in doubt about which of the two a requirement is, treat it as new scope
and ask. Asking costs one turn; a mis-scoped run costs a whole pass.

### Designs

Images are input to the implementer, not to you. Pass the **file paths** in the
delegating message and let the implementer `Read` them — it renders images
visually. Never describe a mockup in prose and pass the description instead:
your paraphrase is lossy in exactly the places (spacing, state, hierarchy) the
implementer needs precision.

If a design implies behaviour the plan does not cover, that is new scope —
handle it as above.

---

## Step 1 — implement

Spawn `implementer` with `subagent_type: "implementer"`.

The plan is the brief and the agent reads it itself, so the message is short.
Include only what the agent cannot get from the file:

```
Plan: <absolute path>
Batch: steps <N>–<M>   (omit on the first call if the plan has <6 steps)

<Extra requirements that bind these specific steps, verbatim.>
<Design image paths relevant to these steps.>
<On batches 2+: the baseline numbers from the previous report's
 `## Next batch`, verbatim, so it does not re-measure a modified tree.>
```

**Batching is the implementer's own discipline** — it takes 4–5 steps per call
and returns `**Status:** partial` with a `## Next batch` section. Your job is to
keep calling it until the plan is done:

- Read `## Next batch` for the next step number and the carried baseline.
- Spawn the next `implementer` with that range and those numbers.
- Repeat until a report comes back `**Status:** done`.

A batched stop is a **success**. Do not treat `partial` as a failure and do not
try to talk the agent into finishing the whole plan in one call — the batching
exists because an over-long run dies mid-edit and costs more to resume.

**If a report comes back `blocked`**, stop the pipeline and surface the
question. A structural divergence — a missing migration, a contract rippling
past `**Touches:**`, an `INSIGHTS.md` entry contradicting a step — is a plan
problem, and plan problems are decided by a human, not worked around by the
orchestrator.

**Multi-agent plans.** If `**Mode:**` is multi-agent, the plan has a
`## Track boundaries` section naming which files each track owns exclusively
and where they rejoin. Spawn one `implementer` per track **in the same
message** so they run in parallel, each told which track it owns. Then run the
joint verification at the sync point before moving to Step 2. If the tracks
would both edit a shared contract, they are not independent — run them
sequentially instead and say why in the final report.

---

## Step 2 — verify coverage (pass 1)

Spawn `plan-verifier` with `subagent_type: "plan-verifier"`:

```
Plan: <absolute path>
Pass: 1 (post-implementation, before review)

This is the coverage pass: which plan items exist in the code at all.
A high `unverifiable` count is expected — no tests have been written for
this change, and none will be in this run.
```

This runs **before** the architecture review on purpose: it is the cheapest
check in the pipeline, and an item at `not done` means the reviewer would be
reviewing code that is about to change.

Read the result table and branch:

| Pass 1 result | What you do |
|---|---|
| all `done` / `unverifiable` | go to Step 4 — nothing to remediate |
| any `not done` or `partial` | go to Step 3 |
| any `deviation` | judge it — see below |

**A `deviation` is not automatically a defect.** The verifier states whether it
still satisfies the plan's intent. If it does, record it for the final report
and move on. If it does not, treat it as a gap and remediate it in Step 3.

---

## Step 3 — remediate the gaps

Only when pass 1 found `not done`, `partial`, or an intent-breaking
`deviation`. Spawn `implementer` in **remediation mode**:

```
Plan: <absolute path>
Remediation: verification findings, not plan steps.

Fix these items from the plan-verifier report:

**Item <n>** — <verdict> — <the verifier's finding, quoted verbatim,
including its file:line evidence>

**Item <n>** — …

Scope is exactly these items. Do not set the plan's Status.
```

Quote the verifier's findings **verbatim, with their evidence**. The
implementer starts with a clean context and cannot see the verifier's report —
a paraphrase loses the `file:line` that makes the finding actionable.

One remediation pass here is normally enough, because pass-1 gaps are missing
work rather than disputed judgement. If a second pass would be needed, that
usually means the plan itself is wrong — say so rather than iterating.

---

## Step 4 — architecture review

Spawn `architecture-reviewer` with `subagent_type: "architecture-reviewer"`:

```
Subject: the working diff for plan <absolute path>
Packages touched: <from the plan's **Touches:**>

The implementer already ran `arch:check`; its last report said:
<the arch:check summary line and baseline from the implementer's report>.
Confirm those numbers, then spend your budget on what the gate cannot see.
```

Handing over the implementer's numbers matters: without them the reviewer
re-derives the mechanical result from scratch, which is the duplicated work its
own prompt now tells it to skip.

**If the plan touches `client/`, say so explicitly** — there is no `arch:check`
in that package, so the review *is* the gate there and deserves the budget.

---

## Step 5 — fix the review findings (max 2 iterations)

The reviewer returns findings on a three-level scale: **CRITICAL** (a layer
breach or a new cycle), **WARNING** (real boundary erosion), **SUGGESTION**
(placement that would be better elsewhere).

**What gets fixed:**

- **CRITICAL — always.** These are broken, not imperfect.
- **WARNING — yes, by default.** These are the findings this loop exists for.
- **SUGGESTION — no.** Carry them to the final report and let a human decide.
  Fixing suggestions is how a review loop turns into an unbounded refactor.

Spawn `implementer` in remediation mode, exactly as in Step 3, quoting each
finding with its `file:line` and its quoted code line.

Then **re-run `architecture-reviewer`** on the new diff, telling it which
findings were addressed. This is iteration 2.

### The iteration cap is hard

**Two remediation iterations, then stop.** After the second review:

- **No CRITICAL left** → proceed to Step 6, and carry any remaining WARNING and
  SUGGESTION findings into the final report.
- **CRITICAL still present** → **stop the pipeline.** Do not start a third
  iteration. Report which findings survived two attempts, what was tried, and
  what the reviewer said the second time.

A finding that survives two fixes is not a finding the loop can close: it is
usually a plan-level or design-level problem wearing a layering costume, and
grinding a third iteration against it burns tokens to produce churn. Hand it to
a human with the evidence.

Watch for **fix-induced findings** — the reviewer flagging something in code
that only exists because of iteration 1's fix. Two of those in a row is the
signal to stop early, before the cap, and say so.

---

## Step 6 — final verification (pass 2)

Spawn `plan-verifier` again:

```
Plan: <absolute path>
Pass: 2 (final)

Since pass 1: <remediation items fixed> and <architecture findings fixed>.
Re-check the items that were `not done`, `partial`, or `unverifiable` in
pass 1. Carry forward the items already `done` with confirmed evidence —
do not re-derive them.

No tests were written in this run, so behavioural criteria needing a suite
stay `unverifiable`. Name them so they can be covered manually.
```

Pass 2 is cheaper than pass 1 by construction: it re-checks a subset and
carries the rest forward. Its table still covers every item — some rows reading
`done (carried from pass 1)`.

---

## Step 7 — report

Report in the user's language. The point is the state of the tree and what a
human must now decide — not a retelling of the run.

```markdown
# SDD: <plan title>

**Plan:** <path> · **Spec:** <path or "none"> · **Result:** <complete | stopped at step N>

## What was built
<2–4 lines: what the feature does now that it did not before, and which
packages changed. Not a step list — the plan already has one.>

## Pipeline
| Stage | Agent | Result |
|---|---|---|
| implement | implementer ×N | steps 1–12 done |
| verify (1) | plan-verifier | 14 done · 2 not done · 6 unverifiable |
| remediate | implementer | items 7, 9 fixed |
| review | architecture-reviewer | 1 CRITICAL · 2 WARNING |
| fix review | implementer | CRITICAL + 2 WARNING fixed |
| review (2) | architecture-reviewer | clean |
| verify (2) | plan-verifier | 21 done · 1 unverifiable |

## Verification
| Check | Package | Result |
|---|---|---|
| typecheck | server | pass |
| vitest hermetic | server | 209 pass / 0 fail (baseline 209/0) |
| arch:check | server | 20 violations (0 E, 20 W) — baseline 20, no new |

## Not covered by tests
<The criteria left `unverifiable` because this run writes no tests, by ID.
This is the input to a manual `test-writer` run — say which are worth it.>

## Open for a human
<Findings carried out of the loop: SUGGESTIONs, surviving WARNINGs, deviations
that were accepted, anything that hit the iteration cap. One line each.>

## Next
<pr-self-review and the PR are manual. Say the tree is dirty and uncommitted.>
```

---

## Cost discipline

This pipeline spawns five to nine agents. What keeps that affordable:

- **Never re-read what an agent already read.** You read the plan once. The
  agents read their own inputs. Do not pull package `CLAUDE.md`, `INSIGHTS.md`
  or source files into your own context to "check" an agent's work — that
  duplicates a whole context window in the one place that persists.
- **Pass numbers forward, not files.** Baselines, `arch:check` summary lines and
  verdict counts travel between agents as short quoted lines in your delegating
  messages. This is the single biggest saving in the run.
- **Quote findings verbatim; never re-investigate them.** If a verdict looks
  wrong, say so in the report — do not open the file to adjudicate it yourself.
- **Do not spawn an agent whose input is empty.** No gaps → no remediation call.
  Clean review → no fix call. An agent spawned to confirm there is nothing to do
  still costs a full context.
- **Stop at the caps.** Two review iterations; one remediation pass after
  pass 1. The caps exist because the marginal iteration reliably costs more than
  the human decision it was avoiding.

## Honesty rules

- **Report what the agents actually returned.** If a check did not run — Docker
  absent, a suite skipped — it is not a check that passed, and it says so in
  the table.
- **Never claim the pipeline completed when it stopped.** A run that hit the
  iteration cap, or stopped on a blocked implementer, is reported as stopped,
  with the step number.
- **Do not soften a surviving CRITICAL.** It goes in `## Open for a human` in
  the reviewer's own words.
- No tests were written in this run — never imply the feature is covered.
