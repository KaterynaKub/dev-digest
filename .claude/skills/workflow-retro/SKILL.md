---
name: workflow-retro
description: "Produces a retrospective of a multi-agent workflow run — token cost per agent, spawn order and wall-clock shape, tool mix, and the qualitative findings that matter: where an agent struggled, what context was duplicated across agents, what was missed and caught late, and which handoffs leaked information. Reads the session transcript and the per-subagent transcripts for hard numbers; never invents a metric it cannot measure. Writes a dated report to .claude/retros/ and, only when a finding is durable, routes it to the right INSIGHTS.md or agent definition. Use after an /sdd run, after any chain of spawned agents, or when the user asks how a workflow went. Trigger terms: retro, retrospective, how did the run go, workflow review, post-mortem, agent performance, скільки токенів, як пройшов запуск, ретро, розбір польотів, оцінка воркфлоу."
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, TodoWrite, AskUserQuestion
metadata:
  tags: retrospective, observability, multi-agent, cost, orchestration
---

# Workflow retro

A multi-agent run leaves two kinds of trace behind: **numbers** in the session
transcripts, and **judgement** that exists only in the current context window
and dies with it. This skill captures both before the second one is lost.

The output is one file: `.claude/retros/YYYY-MM-DD-slug.md`. Everything else —
the measuring, the reading, the questions — exists to make that file true.

**Write it while the run is still in context.** A retro produced a day later
from transcripts alone gets the numbers right and the findings wrong, because
the reason an agent struggled is rarely written down anywhere.

## What this is not

- **Not a grading exercise.** "The implementer did well" is not a finding.
  A finding names a mechanism: what information was missing, where it should
  have come from, and what it cost.
- **Not `engineering-insights`.** That skill captures facts about *the
  codebase*. This one captures facts about *how the agents worked*. When a
  retro turns up a codebase fact, hand it over — see `## Routing findings`.
- **Not a transcript summary.** Nobody re-reads a run. Report what should
  change next time.
- **Not a cost report alone.** Numbers without findings are a bill, not a
  retro.

## Step 1 — locate the run

Everything measurable lives in two places. Resolve both before analysing.

**Main session transcript** — one JSONL per session:

```
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

The project slug for this repo is `D--repos-dev-digest`. The newest file by
mtime is the current session; confirm rather than assume, because a resumed
session appends to its original file.

**Per-subagent transcripts** — a sibling directory named after the session:

```
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.jsonl
~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.meta.json
```

The `.meta.json` is small and worth reading first — it carries `agentType`,
`description`, `toolUseId`, `spawnDepth`, and `model`.

### The thing that will mislead you

**The main transcript does not contain subagent work.** `isSidechain` is `0`
for a session that spawned agents through the `Agent` tool; the subagent's
turns, its tool calls, and its token spend live only in its own file under
`subagents/`.

Two consequences, and both produce a wrong retro if missed:

1. **Summing usage from the main transcript alone undercounts the run** —
   often by an order of magnitude, since a subagent's cache reads dwarf the
   orchestrator's.
2. **A background agent that is still running has an incomplete file.**
   Check whether the run actually finished before reporting its cost.

If the `subagents/` directory does not exist, the run had no spawned agents.
That is a valid single-agent retro — say so, and skip the per-agent tables
rather than fabricating them.

## Step 2 — measure

Read the JSONL with a script, never by eye. Each `assistant` line carries
`message.usage` with these fields:

| Field | Means |
|---|---|
| `input_tokens` | fresh input, uncached |
| `output_tokens` | generated |
| `cache_creation_input_tokens` | written to cache this turn |
| `cache_read_input_tokens` | served from cache |

**Report all four.** Collapsing them into one number hides the finding that
matters most in multi-agent runs: a large `cache_read` against a small
`input_tokens` means the context was reused well, while repeated
`cache_creation` across sibling agents means the same material was paid for
more than once.

A working extraction, adapt as needed:

```bash
python -c "
import json,collections,glob,os,sys
d=sys.argv[1]
for f in sorted(glob.glob(os.path.join(d,'*.jsonl'))):
    inp=out=cr=cc=0; tools=collections.Counter(); turns=0; first=last=None
    for line in open(f,encoding='utf-8'):
        try: e=json.loads(line)
        except: continue
        ts=e.get('timestamp')
        if ts: first=first or ts; last=ts
        m=e.get('message') or {}
        if isinstance(m,dict) and 'usage' in m:
            u=m['usage']; turns+=1
            inp+=u.get('input_tokens',0); out+=u.get('output_tokens',0)
            cr+=u.get('cache_read_input_tokens',0)
            cc+=u.get('cache_creation_input_tokens',0)
        c=m.get('content') if isinstance(m,dict) else None
        if isinstance(c,list):
            for b in c:
                if isinstance(b,dict) and b.get('type')=='tool_use':
                    tools[b.get('name')]+=1
    print(f'{os.path.basename(f)} turns={turns} in={inp} out={out} cache_read={cr} cache_create={cc}')
    print('  first:',first,'last:',last)
    print('  tools:',dict(tools))
" <subagents-dir>
```

Collect, per agent and for the orchestrator:

- **the four token figures** and turn count;
- **tool mix** — the counter above. A `Bash`-heavy agent that was given `Read`
  and `Grep` is a finding about tool choice, not a statistic;
- **spawn order and wall-clock span** — from `timestamp` on the first and last
  line, and from the order of `Agent` tool calls in the main transcript;
- **model per agent**, from `.meta.json`. A cheap step running on `opus` is a
  finding.

**Sequential or parallel?** Compare spans. Two agents whose `[first, last]`
intervals overlap ran in parallel; adjacent non-overlapping spans ran in
sequence. Say which, because a sequential chain that had no data dependency is
the single most common wasted-wall-clock finding.

### Honesty about cost

You can report tokens. **You cannot report money** unless the user gives you
current prices — pricing is not in the transcript, and a fabricated dollar
figure is worse than none. If the user wants cost, ask for the rate or state
tokens only.

## Step 3 — the qualitative half

This is the part transcripts cannot give you and the reason the skill runs
while the context is warm. Go through the run and answer each of these
explicitly. `None observed` is a real answer; an empty section is not.

**Where an agent struggled.** Which agent needed several attempts at the same
thing? What did it search for repeatedly before finding it? Where did it ask a
question the orchestrator could have answered from context it already had?
Name the mechanism — "no entry point named in the prompt", "the contract is
vendored twice and it read only one copy" — not the symptom.

**What went easily and why.** Worth recording only when it is reproducible: a
prompt shape that worked, a constraint stated up front that prevented a whole
class of error, an existing artefact that made the task cheap. This is what you
copy into the next run.

**Duplicated context.** The dominant cost in multi-agent workflows. Which files
did more than one agent read? Which facts were re-derived independently? Which
part of the orchestrator's prompt was pasted into every child? Look for the same
`Read` or `Bash cat` target across sibling transcripts — that is duplication you
can point at.

**What was missed.** Anything a later stage caught that an earlier one should
have; anything the user corrected; anything discovered after "done" was
reported. For each: which stage *should* have caught it, and what would have
made it possible.

**Handoff quality.** A subagent starts cold. Did each prompt carry what the
child needed — paths, constraints, what "done" means, prior decisions? Where a
child asked for something the parent had, that is a handoff defect with an
exact fix.

**Decision churn.** Decisions made, reversed, then remade. Each reversal is
rework: name what would have settled it earlier — usually a question asked
before spawning rather than after.

**Images and attachments.** A specific, easily-missed defect: **images in the
main conversation do not reach a spawned subagent.** If a run passed design
mockups to an agent as prose because the images could not travel, record it —
it changes what the agent could verify, and it is invisible in the numbers.

## Step 4 — recommendations

Every recommendation must be actionable by someone who was not in the run, and
must name **where it lands**: an agent definition, a skill, a `CLAUDE.md`, an
orchestration order, a prompt template.

Bad — `Improve agent prompts.`
Good — `spec-creator asked which package owns prompt assembly, then found it
itself in two Greps. Its definition tells it to read package CLAUDE.md files
but not that reviewer-core owns prompt assembly. Add that pointer to
reviewer-core/CLAUDE.md, where every agent already reads.`

Rank by **cost recovered**, not by tidiness. A recommendation that saves a
whole agent pass outranks five prompt-wording fixes.

State the trade-off when there is one. "Merge these two agents" saves a spawn
and loses a clean-context check — say both.

## Step 5 — the report

Write to `.claude/retros/YYYY-MM-DD-slug.md`. Create the directory if missing.
Slug names the workflow — `sdd-project-context`, not `retro-1`.

```markdown
# Retro: <workflow name>

**Date:** YYYY-MM-DD · **Session:** <session-id> · **Trigger:** <what was run>
**Agents:** <N spawned, depth D> · **Result:** <completed | stopped at X>

## Run shape

<Spawn order as a list or diagram, with what each agent received and returned.
Mark parallel vs sequential explicitly.>

## Cost

| Agent | Model | Turns | Input | Output | Cache read | Cache created |
|---|---|---|---|---|---|---|
| orchestrator | | | | | | |
| <agent-type> | | | | | | |
| **Total** | | | | | | |

<One paragraph reading the table: where the spend went, and whether cache
reuse was healthy. Tokens only — no money unless a rate was supplied.>

## Tool mix

| Agent | Tools used | Notable |
|---|---|---|

## What worked

<Reproducible successes only, each with why it worked.>

## What was hard

<Per finding: which agent, what it hit, the mechanism, the cost.>

## Duplicated context

<Files or facts more than one agent paid for. Name them.>

## What was missed

<Caught late or by the user. For each: which stage should have caught it.>

## Handoff quality

<Per spawn: did the child get what it needed? Defects with exact fixes.>

## Recommendations

<Ranked by cost recovered. Each names where the change lands.>

| # | Recommendation | Lands in | Recovers |
|---|---|---|---|

## Not measurable

<What this retro could not determine, and why. Never leave this implicit.>
```

Keep it under ~150 lines. A retro nobody finishes reading changes nothing.

## Routing findings

The report is the record. Some findings belong somewhere they will be *read*:

| Finding is about | Route to |
|---|---|
| the codebase — a trap, a quirk, a trade-off | the matching `INSIGHTS.md` via `engineering-insights` |
| one agent's scope, tools, or instructions | that agent's `.claude/agents/<name>.md` |
| the pipeline's order or stage set | the orchestrating skill (e.g. `sdd`) |
| a convention any agent must know | the relevant `CLAUDE.md` |

**Propose these edits; do not apply them silently.** Changing an agent
definition or a `CLAUDE.md` alters every future run — list the edit, say what
it fixes, and let the user approve. Applying a codebase insight through
`engineering-insights` is the one case that needs no separate approval,
because that skill owns the format and target.

## Honesty rules

- **Never invent a number.** If the subagent directory is absent, incomplete,
  or the run is still going, say so in `## Not measurable`.
- **Never report cost in currency** without a supplied rate.
- **Distinguish measured from observed.** Token counts are measured.
  "The implementer struggled with the vendored contract" is observed, from
  this context — and if the context is gone, it is unavailable, not guessable.
- **A retro with no findings is suspicious but possible.** Say `None observed`
  rather than padding.
- If the user asks for a retro of a run you were not part of and whose
  transcript you cannot find, say that plainly. Numbers alone still make a
  useful partial retro — label it as one.
