# e2e — `@devdigest/e2e`

Deterministic browser journeys over the real stack. No LLM, no API keys — specs
target read-only seeded data.

## Before answering

Search `docs/`, `INSIGHTS.md` first.

## Conventions (not obvious from code)

- `specs/` holds `*.flow.json` test flows, NOT written specs. Prose belongs
  in `docs/`.
- agent-browser is a CDP CLI, not a test framework: a step fails when its command
  exits non-zero — that is the primary assertion.
- Commands share one browser session, so steps within a flow are order-dependent.
- Run order is the lexical order of spec filenames — renaming reorders the suite.
- Flows must stay read-only and LLM-free; never add a step that triggers a review.

## Use when

- Flow format, env vars → read `README.md`
- Deep-dives → read `docs/` · findings → read `INSIGHTS.md`
- A flow fails on data → read `../server/src/db/seed.ts`
