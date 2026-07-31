# e2e — docs

Written documentation for the browser suite. This is where prose lives, because
`../specs/` is taken by `*.flow.json` test flows.

Naming: `short-slug.md`, one topic per file.

## What belongs here

- The agent-browser command vocabulary and the conventions layered on it.
- How a flow is structured, and how to add one.
- Which seeded data flows depend on, and why they must stay read-only.
- Planned flow coverage — proposals live here too, since `specs/` is unavailable.

## What does not

- Non-obvious facts and traps → `../INSIGHTS.md`
- The runner's env vars and format → already in `../README.md`; link instead
- Actual flows → `../specs/*.flow.json`

## Rules

- Never document a flow that needs an API key or triggers a review.
- When adding a flow, state its position in the lexical run order — renaming
  reorders the suite.
