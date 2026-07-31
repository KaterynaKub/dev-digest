# server — specs

One file per non-trivial change, written **before** the code. A spec says what
we are building, why, and what "done" means — not how every function looks.

Naming: `NNNN-short-slug.md`, sequential, never renumbered.

## Template

```markdown
# NNNN — Title

**Status:** draft | accepted | done | superseded by NNNN
**Date:** YYYY-MM-DD
**Touches:** src/modules/x · src/platform/y

## Problem
What is broken or missing today. Observable, not theoretical.

## Approach
The chosen shape. Name the files that change.

## Rejected alternatives
What else was considered and why it lost — the part future readers need.

## Acceptance
- [ ] Checkable statements; each a test or an observable behaviour.

## Risks
What could break elsewhere.
```

## Rules

- Status stays current — a stale `draft` is worse than no spec.
- Link, do not restate: point at `../README.md` or a module `CLAUDE.md`.
- When a spec yields a durable non-obvious fact, move it to `../INSIGHTS.md`.
  Specs are historical; insights are live.
