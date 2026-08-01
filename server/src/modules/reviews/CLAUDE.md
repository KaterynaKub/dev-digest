# modules/reviews

Runs agent reviews on a PR, persists grounded findings, streams progress.
`service.ts` is thin — the weight is in `run-executor.ts`.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- The route does NOT await execution — runs are background work returning run ids.
- The diff is loaded once per batch; per-agent failures are isolated, but
  pre-work failure fails every queued run.
- Repo-intel enrichment is best-effort: a failure degrades to a missing prompt
  section, never a failed run.
- `blockers` is computed from finding severities against the agent's `ciFailOn`
  gate — NOT from the model's `verdict`.
- Failures and cancels still persist a trace, so the reason survives a reload.

## Use when

- What the model sees → read the "Review context" section of `../../../README.md`
- Grounding and scoring rules → read `../../../../reviewer-core/CLAUDE.md`
- Adding repo context → read `../repo-intel/CLAUDE.md`
