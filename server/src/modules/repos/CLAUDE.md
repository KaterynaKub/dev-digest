# modules/repos

Add, list, refresh, remove repositories. Owns the async `clone` job that
produces the checkout every other feature reads.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Clone authenticates with the stored PAT so private repos work — never log the
  resulting URL, it embeds the token.
- The clone job ENQUEUES indexing rather than calling it, so the heavy pass gets
  its own timeout and retry budget.
- An index-enqueue failure must not fail the clone; the user retries via
  `POST /repos/:id/resync`.
- Clones are shallow (`CLONE_DEPTH`) — history-dependent analysis sees a
  truncated repo.

## Use when

- Indexing contract → read `../repo-intel/CLAUDE.md`
