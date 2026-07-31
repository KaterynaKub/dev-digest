# server — docs

Deep-dives that are too long for a `CLAUDE.md` and too explanatory for
`../README.md`: subsystem walkthroughs, data-flow narratives, decision context.

Naming: `short-slug.md`, one topic per file.

## What belongs here

- How a subsystem works end to end (jobs, SSE run streaming, the DI container).
- Data models and their lifecycle beyond what the schema shows.
- Operational guidance: migrations, seeding, local troubleshooting.

## What does not

- Non-obvious facts and traps → `../INSIGHTS.md`
- Planned changes → `../specs/`
- Route lists, env tables, DI diagram → already in `../README.md`; link instead
- Rules for agents → the nearest `CLAUDE.md`

## Rules

- Start with why the subsystem exists, then how it works.
- Link to code by path; do not paste code that will drift.
- If a doc is only true this week, it is a spec, not a doc.
