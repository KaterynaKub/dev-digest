# modules/skills

CRUD for reusable review-instruction blocks (skills), their body-version
history, and stateless markdown/zip import preview. Linking a skill to an
agent (order, attach/detach) is owned by `../agents` — see below.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md`,
`../../../specs/0001-skills-module.md` first.

## Conventions (not obvious from code)

- `skill_versions` snapshots ONLY `body` — narrower than `agent_versions`,
  which bumps on ANY config field. Renaming/retyping/toggling `enabled` never
  bumps a skill's version; only a `body` edit does. This is deliberate: a
  skill's prompt-visible payload is its body, so that's the only thing a past
  review's prompt actually captured. Do not "fix" this to match agents.
- `POST /skills` forces `enabled: false` whenever `source !== 'manual'` —
  regardless of what the request body asks for. This is the ONE vetting gate
  for imported content; it lives in `service.create`, nowhere else.
- `source: 'imported_url'` is reused for BOTH a single uploaded file and a zip
  archive. There is no "uploaded file" enum value — adding one is a migration
  (`SkillSource` lives in the DB as a text enum) plus a client copy change, for
  no behavioural gain. Provenance instead comes from `evidence_files` (the
  archive-relative path of the entry that was used).
- `POST /skills/import/preview` is STATELESS: it parses and returns a
  `SkillDraft`, writing nothing to the DB. A skill is only persisted once the
  (client-editable) draft is confirmed via a normal `POST /skills`.
- Archive import (`.zip`) only ever reads `.md`-suffixed central-directory
  entries. Non-`.md` entries (`.sh`, `.js`, anything else) are enumerated for
  metadata (name/size) but their `openReadStream` is NEVER called — that is
  the literal implementation of "executable parts are never processed," not a
  filter applied after the fact.
- `@fastify/multipart` is registered INSIDE this module's `routes.ts`, not
  globally in `app.ts` — module plugins are Fastify-encapsulated, so this
  module's `limits.fileSize` override never affects the global 1MB body cap
  used by every other route.
- `helpers.ts` does NOT import `./repository.js` — it declares `SkillRowLike`
  structurally instead. Importing the row type from the repository is exactly
  what created the tracked `no-circular` warning in `modules/agents`
  (helpers.ts ⇄ repository.ts); skills does not repeat it. See
  `.dependency-cruiser.cjs`'s comment block for the full list of tracked
  warnings — this module must not add a new one.
- `/agents/skill-counts` lives HERE (reads `skillsRepo.countsByAgent`, one
  grouped query), even though its path starts with `/agents` — the data
  belongs to skills. It must resolve as a static route ahead of
  `/agents/:id`'s uuid-validated param schema; a route smoke test guards this.
- `skillsForAgents` (this module) is the READ side of `agent_skills`; the
  WRITE side (link/reorder/`setSkills`) stays in `../agents/repository.ts`.
  Two repositories over one join table is intentional — `no-cross-module-service`
  only forbids importing another module's `service.ts`/`routes.ts`.
- The wrapping of imported skill bodies in `wrapUntrusted()` for the review
  prompt is NOT this module's job — it belongs to
  `../reviews/run-executor.ts`, which is the one place that knows a skill's
  `source`. `reviewer-core`'s `PromptParts.skills: string[]` stays a plain
  array of pre-rendered blocks.

- `modules/conventions` creates skills through the normal `POST /skills` with
  `source: 'extracted'`, so they land `enabled: false` behind the gate above.
  Its "Create skill from conventions" modal renders the Enabled toggle
  read-only rather than asking for an exemption — do not add one.

## Use when

- How linked skills reach a review prompt → read `../reviews/CLAUDE.md`
- Agent-side link/reorder API → read `../agents/CLAUDE.md`
- Where extracted convention skills come from → read `../conventions/CLAUDE.md`
