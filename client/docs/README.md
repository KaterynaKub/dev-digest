# client — docs

Deep-dives too long for `CLAUDE.md` and too explanatory for `../README.md`:
component architecture, state and data-fetching patterns, i18n and theming.

Naming: `short-slug.md`, one topic per file.

## What belongs here

- How a screen or component family is structured and why.
- Data-fetching and caching patterns (TanStack Query keys, invalidation).
- Cross-cutting concerns: app-shell, routing, i18n, theming.

## What does not

- Non-obvious facts and traps → `../INSIGHTS.md`
- Planned UI work → `../specs/`
- The route map and commands → already in `../README.md`; link instead

## Rules

- Link to code by path; do not paste JSX that will drift.
- Name the states a pattern must handle: loading, empty, error, populated.
