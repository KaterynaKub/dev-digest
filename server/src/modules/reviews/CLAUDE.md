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
- Intent (`intent.ts` — `IntentDeriver`) is derived ONCE per review batch, as
  a second best-effort shared pre-work step immediately after `loadDiff` in
  `run-executor.ts`. A failure (unconfigured provider, no GitHub token, model
  timeout) degrades to a missing `## Derived intent / scope` prompt section —
  it never fails a queued run. The try/catch around the intent step in
  `executeRuns` is load-bearing: an uncaught throw there would hit `failAll`
  and fail every queued run over something that is, by design, optional
  context.
- `run-executor.ts` (never `reviewer-core`) calls `wrapUntrusted('intent', …)`
  on the rendered intent block before passing it to `reviewPullRequest` — the
  same rule already documented above for `skills`.
- Intent never filters a finding. Scope (`in_scope`/`out_of_scope`) only
  changes prompt WORDING (`reviewer-core`'s `SCOPE_RULE`, next to
  `INJECTION_GUARD`); `groundFindings` remains the only filter, anywhere in
  the pipeline.
- External links referenced in a PR body are fetched ONLY through the
  `HttpFetcher` port (`container.httpFetcher`), under a deny-by-default
  workspace allowlist (`settings.intent_link_allowlist`, empty by default).
  `collectIntentInputs`-equivalent logic in `intent.ts` checks the allowlist
  BEFORE any DNS/network work — a non-matching or unset allowlist produces a
  `missing_context` note and zero outbound calls. Never reach for a raw
  `fetch` here; see `server/CLAUDE.md`'s outbound-HTTP convention.
- `pr_intent` freshness: `deriveIntent` reuses a stored row when its
  `head_sha` matches the PR's current head and the caller didn't pass
  `force: true` — no model call, no cost. `POST /pulls/:id/intent/derive`
  always forces a re-derive (the UI's "Re-derive" action).

## Use when

- What the model sees → read the "Review context" section of `../../../README.md`
- Grounding and scoring rules → read `../../../../reviewer-core/CLAUDE.md`
- Adding repo context → read `../repo-intel/CLAUDE.md`
