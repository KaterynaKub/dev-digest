# modules/agents

CRUD for review agents: provider, model, system prompt, strategy, CI gate, and
the per-agent `repo_intel` toggle.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Config changes snapshot into `agent_versions` (everything except `enabled`) —
  a new field missing from the snapshot silently breaks reproducibility.
- A new agent config field must land in four places: the Zod contract, the DB
  schema (+ migration), the version snapshot, and the Agent editor UI.
- `ciFailOn` is a severity gate, not a verdict.
- `repo_intel: false` must skip ALL enrichment, so the prompt matches the
  repo-intel-off baseline exactly.

## Use when

- How these fields affect a run → read `../reviews/CLAUDE.md`
- Writing agent prompts → read `../../../../docs/agent-prompts/README.md`
