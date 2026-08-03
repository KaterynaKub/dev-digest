# 0001 — Skills module

**Status:** done
**Date:** 2026-08-03
**Touches:** src/modules/skills · src/db/schema/skills.ts · src/db/rows.ts ·
src/platform/container.ts · src/modules/index.ts · src/vendor/shared/contracts/knowledge.ts

## Problem

Skills — reusable text blocks of review instructions — already have tables
(`skills`, `skill_versions`, `agent_skills`), contracts (`Skill`, `SkillType`,
`SkillSource`, `AgentSkillLink`), a link/reorder API on `agents`, and a prompt
slot (`PromptParts.skills`). There is no CRUD module to create, edit, version,
or import them, so the tables and the prompt slot sit empty. This wave (0–2)
builds the server-side module and the file/zip import path; wiring skills into
an actual review run (`run-executor.ts`), the client UI, and the seed data are
separate waves.

## Approach

- New module `server/src/modules/skills/` following the standard shape
  (`routes.ts` → `service.ts` → `repository.ts` → `helpers.ts` → `constants.ts`),
  mirroring `modules/agents/`.
- **No migration.** All three tables already exist in `0000_init`. We
  deliberately do not add:
  - `updated_at` — `skill_versions.created_at` is already the "when did the
    body change" signal.
  - `created_by` — single-user local product, no reader for it yet.
  - `source_url` — provenance is written into the existing `evidence_files:
    jsonb string[]` column (the archive-relative path of the entry that was
    used, e.g. `["skills/test-quality/SKILL.md"]`).
  - `source: 'imported_url'` is reused for BOTH a single uploaded file and a
    zip archive. The enum name predates this feature; renaming it would need a
    migration and a client copy update for no behavioural gain. Documented in
    `modules/skills/CLAUDE.md` so nobody "fixes" it later.
- **Versioning rule is narrower than agents.** `skill_versions` snapshots ONLY
  `body`:
  - `body` changes → `version + 1` + a new `skill_versions` row.
  - `name` / `description` / `type` changes → updated in place, no bump.
  - toggling `enabled` → no bump.
  - insert → `version = 1` + a v1 snapshot.
  This is intentionally asymmetric with `agents` (which bump on ANY config
  change) — a skill's prompt-visible payload is its body; renaming or
  retyping it doesn't change what got sent to a past review.
- **Trust policy.** `reviewer-core` stays a pure renderer — `PromptParts.skills:
  string[]` is unchanged. Wrapping untrusted bodies in `wrapUntrusted()` is the
  *caller's* job (`run-executor.ts`, wave 2 of the overall Skills plan — out of
  scope here). The module's own gate: `POST /skills` forces `enabled: false`
  whenever `source !== 'manual'`, so an imported skill is never active until a
  human reviews and flips it on. This is "Disabled until you vet + enable it,"
  already promised by copy elsewhere in the product.
- **Import is two stateless calls.** `POST /skills/import/preview` parses a
  markdown file or a zip and returns a `SkillDraft` — nothing is persisted.
  The (future) client renders that draft in an editable form; a normal
  `POST /skills` call persists it once the user confirms. `parseSkillMarkdown`
  (in `helpers.ts`) reads YAML frontmatter with a small hand-rolled scalar
  reader (no `js-yaml` dependency — avoids anchors/aliases/`!!`-tag attack
  surface on untrusted uploads), falling back to the first `# H1` heading, then
  to filename + first 200 characters of body.
- **Archive import (`.zip`)** uses `yauzl` (streaming, async-only API) inside
  `modules/skills/routes.ts`, guarded structurally: magic-byte sniff (never
  trust `content-type`), a request body-size cap, an entry-count cap, summing
  `uncompressedSize` from the central directory BEFORE opening any entry
  stream (a zip bomb defense that's cheap because yauzl exposes the claimed
  size up front), zip-slip-shaped path rejection (defense in depth — nothing
  is ever written to disk, so slip is structurally impossible, but rejecting
  `..`/absolute/backslash/NUL paths keeps intent legible), symlink rejection by
  file-mode bits, and — the concrete answer to "executable parts are never
  processed" — only `.md`-suffixed central-directory entries are ever passed to
  `openReadStream`; `.sh`/`.js`/other payloads in the archive are never
  unzipped or read. Entry selection order: root `SKILL.md` → `<dir>/SKILL.md` →
  root `README.md` → the largest `.md` entry. Zero `.md` entries → 422.
- `/agents/skill-counts` lives in the `skills` module (it reads through
  `skillsRepo`, one grouped query) even though the path starts with `/agents`,
  because the data belongs to skills. The static route `/agents/skill-counts`
  must be registered so it doesn't fall through to `/agents/:id`'s
  uuid-validated param schema (verified with a route smoke test).

## Rejected alternatives

- **Draft-in-DB for preview** — would need a `status` column (migration) and
  cleanup of abandoned drafts (orphan rows with no TTL story). Rejected for a
  stateless preview that the client just holds in form state.
- **Server-side temp store keyed by a token** — adds state + TTL management for
  no benefit over returning the parsed draft directly in the response.
- **Parsing on the client** — would ship a zip reader and the same defenses
  into the browser bundle, running untrusted-input parsing on the less
  trusted side of the wire for zero benefit (the server already receives the
  bytes over multipart).
- **`js-yaml` for frontmatter** — rejected due to attack surface (anchors,
  aliases, custom tags) on content nobody has vetted yet; a scalar-only
  ~30-line reader covers `name`/`description`/`type` and nothing else.
- **`adm-zip`** — buffers the whole archive in memory and has a history of
  zip-slip CVEs. **`unzipper`** — heavier dependency tree, less precise control
  over "stream only what I explicitly chose to open." `yauzl` was chosen for
  its streaming, async-first API and because `uncompressedSize` is available
  from the central directory before any bytes are read.

## Acceptance

- [ ] `GET/POST/PUT/DELETE /skills(/:id)` and `/skills/:id/versions(/:version)`
      behave as documented in `modules/skills/CLAUDE.md` and are workspace-scoped.
- [ ] `POST /skills` with `source !== 'manual'` always persists `enabled: false`
      regardless of the request body.
- [ ] A `body` edit bumps `version` and appends a `skill_versions` row; edits to
      `name`/`description`/`type`/`enabled` alone do not.
- [ ] `/agents/skill-counts` resolves as a static route, never falls into
      `/agents/:id`'s uuid schema (422).
- [ ] `POST /skills/import/preview` with a `.md` or `.zip` file returns a
      `SkillDraft` and writes NOTHING to the database.
- [ ] Archive import never opens a read stream for a non-`.md` entry (verified
      by a spy test), rejects oversized/over-count archives, and rejects
      symlinks and zip-slip-shaped paths.
- [ ] `pnpm db:generate` produces an empty diff (no migration needed).
- [ ] `pnpm arch:check` warning count does not exceed the pre-existing 6.

## Risks

1. **The experiment (does a skill change model output) isn't provable by this
   wave alone** — it needs `run-executor.ts` wiring (a later wave) and a live
   model run, not just green tests.
2. **`SkillSource` has no "uploaded file" value** — `imported_url` is reused for
   both file and archive imports. Changing the enum later is a migration plus
   a client copy change; documented in `modules/skills/CLAUDE.md` so it isn't
   "fixed" by accident.
3. **`skills.json` (client) promises URL import and a community catalog** that
   this scope does not build — out of scope for the server module; the client
   wave decides whether to leave those keys unused or hide the entry points.
4. **A stored import body is not guaranteed to byte-match the source file**,
   because the preview is fully editable before save. Provenance is tracked via
   `source` + `evidence_files` (a path), not a content hash — intentional, but
   worth remembering before anyone assumes byte-identity.
5. **This module does not create `agent_versions` snapshots** — that remains
   `agents`' responsibility (`AgentsRepository.snapshotVersion` already reads
   linked skill ids via `skillIdsForAgent`, which is unaffected by this
   module's read-side `skillsForAgents`).
