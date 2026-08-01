# modules/polling

Manual PR-list refresh for one repo: `POST /repos/:id/poll`. `routes.ts` is the
whole module.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Polling NEVER triggers a review — review is always user-initiated. Auto-review
  here would spend LLM budget without consent.
- Upsert on `(repoId, number)`, updating only mutable fields, so local review
  history survives a re-poll.
- Only open PRs are listed; a PR merged upstream keeps its last-known local status.

## Use when

- Making this a background job → read `../../platform/jobs.ts`
