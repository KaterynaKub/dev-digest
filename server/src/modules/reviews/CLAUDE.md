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
- `run-executor.ts` is where linked skills join the prompt: `buildSkillBodies`
  reads `skillsRepo.skillsForAgents([agentId])`, drops any `enabled: false`
  skill, and wraps every non-`manual`-source body in `wrapUntrusted()` before
  handing `skills: string[]` to `reviewPullRequest`. This is independent of
  the per-agent `repo_intel` toggle — an agent with `repo_intel: false` still
  gets its linked skills. `reviewer-core` applies no trust policy of its own
  (see its `prompt.ts` doc comment); this module is the one place that does.

## Use when

- What the model sees → read the "Review context" section of `../../../README.md`
- Grounding and scoring rules → read `../../../../reviewer-core/CLAUDE.md`
- Adding repo context → read `../repo-intel/CLAUDE.md`
