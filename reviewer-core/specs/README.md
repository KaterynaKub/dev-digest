# reviewer-core — specs

Engine changes, written **before** the code. Prompt and grounding changes alter
every review's output, so a spec here is not optional ceremony.

Naming: `NNNN-short-slug.md`, sequential, never renumbered.

## Template

```markdown
# NNNN — Title

**Status:** draft | accepted | done | superseded by NNNN
**Date:** YYYY-MM-DD
**Touches:** src/prompt.ts · src/grounding.ts

## Problem
What the engine gets wrong today, with an example review.

## Approach
The change to the pipeline. Show the prompt section before and after.

## Effect on output
What findings change, and why that is an improvement rather than a shift.

## Rejected alternatives
What else was considered and why it lost.

## Acceptance
- [ ] Checkable statements; each a test or an observable behaviour.
- [ ] Grounding and score-recomputation invariants still hold.
```

## Rules

- Any change to `prompt.ts` or `grounding.ts` gets a spec — there is no eval gate
  in the starter, so the spec is the record.
- Never propose weakening grounding or trusting the model's score.
- Durable findings go to `../INSIGHTS.md`.
