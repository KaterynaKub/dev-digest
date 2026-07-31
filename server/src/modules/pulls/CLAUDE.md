# modules/pulls

Import and serve pull requests: diff, commits, body, comments. Derives the
review status shown in the PR list.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Two different "status" concepts: the DB `status` column is GitHub's merge state
  (open/merged/closed); the review status (needs_review/reviewed/stale) is
  DERIVED in `status.ts` from `lastReviewedSha` vs head, plus age. Never conflate
  them or persist the derived one.
- Severity rollups are computed, not stored.
- Helpers here stay pure (no DB, no `this`) so they unit-test without Docker.

## Use when

- Diff loading → read `../reviews/CLAUDE.md` (owned by `diff-loader.ts` there)
