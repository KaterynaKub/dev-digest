# client — specs

UI and flow specs, written **before** the code: what a screen must do, which
states it has, what "done" means.

Naming: `NNNN-short-slug.md`, sequential, never renumbered.

## Template

```markdown
# NNNN — Title

**Status:** draft | accepted | done | superseded by NNNN
**Date:** YYYY-MM-DD
**Touches:** src/app/x · src/lib/hooks/y

## Problem
What the user cannot do today.

## Flow
Steps, and the states each screen can be in: loading · empty · error · populated.

## API
Endpoints consumed. Link `../../server/README.md` rather than restating shapes.

## Rejected alternatives
What else was considered and why it lost.

## Acceptance
- [ ] Checkable statements; each a test or an observable behaviour.
```

## Rules

- Always enumerate empty and error states — they are where UI specs decay.
- Status stays current; a stale `draft` is worse than no spec.
- Durable non-obvious findings go to `../INSIGHTS.md`, not here.
