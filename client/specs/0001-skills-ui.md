# 0001 — Skills UI

**Status:** done
**Date:** 2026-08-03
**Touches:** src/app/skills · src/app/agents/[id]/_components/AgentEditor ·
src/lib/hooks/skills.ts · src/lib/api.ts · src/vendor/ui/nav.ts ·
messages/en/skills.json · messages/en/agents.json

## Problem

The server module (`server/specs/0001-skills-module.md`) and `run-executor.ts`
wiring already make skills affect a review. There was no UI to create, edit,
import, preview, or link a skill to an agent — the tables were reachable only
via `curl`.

## Flow

**`/skills` — two-column workspace**
- Full-height flex, each column scrolling independently: a 340px list rail on
  the left, the selected skill's `SkillDetail` pane filling the rest. Editing
  never leaves the page, so a user can work through several skills without
  losing scroll position.
- Left rail: heading + Add button, search, then a vertical card list (not a
  responsive grid — a fixed-width rail has room for exactly one column).
- Card: type-coloured `Sparkles` glyph, mono name, `Toggle` (stops propagation
  so toggling doesn't also select), description (2-line clamp), type `Badge`,
  a source glyph + label, a `needsVetting` chip for any `source !== 'manual'`,
  and a hairline-separated stats strip. That strip says **Coming soon** rather
  than showing "3 agents · 71% pull · 74% accept": no review telemetry is
  collected, and invented numbers would read as measured.
- State placement: loading/error/empty replace the **detail** column, not the
  page, so the header and search stay usable during a refetch. A search that
  matches nothing is `page.noMatch` (no import CTA — the user already has
  skills), distinct from an empty library (`page.empty`, with the CTA).
- The detail pane resolves the selection against the **unfiltered** list, so
  typing in the search box can't blank a skill mid-edit (covered by a test).
- Add button: `Dropdown` → "Create from scratch" (`CreateSkillModal`),
  "Import from file" (`AddSkillDrawer`), "Search community skills…"
  (`CommunityDrawer`, a Coming soon panel). `fromUrl` stays unused.

**`SkillDetail` — tabbed pane (Config · Preview · Evals · Stats · Versions)**
- Header: name, type badge, version chip, and a "Run on evals" button. The
  button is shown because it is the centre of the intended workflow, but no
  runner exists, so it reports Coming soon on click instead of being hidden.
- Tab state is **local, not `?tab=`**: this is a pane inside a list page, and
  URL state would make the browser Back button undo a tab switch rather than
  leave the page (the opposite of `AgentEditor`, which *is* the page).
  Selecting a different skill resets to Config.
- **Config** — `name`, `description` (2 rows), `type`, `body` (16 rows, mono),
  `enabled`. Plain `useState`, explicit Save, `key={skill.id}` remounts on
  switch. The body sits in a file-strip box: `<name>.md`, an `unsaved` badge
  (diffed against the *persisted* body, so it clears itself after a save), and
  an approximate token count (~4 chars/token — the client has no tokenizer and
  the server returns no count).
- **Requirement:** a caption under `description` states that the description
  is the skill's interface and should be written directively —
  `editor.descriptionHint`, covered by a test.
- **Preview** — body via `<Markdown>`, plus version/enabled badges and the
  `untrustedNotice` banner for non-`manual` sources. The banner belongs here
  most of all: rendered, an injection attempt looks most like real instructions.
- **Evals / Stats** — `ComingSoon`. Neither an eval runner nor review
  telemetry exists; both render an explanation of what the tab will measure.
- **Versions** — snapshots newest-first, with the current version flagged.
  *Restore is a forward operation*: with no restore endpoint, it PUTs the old
  body through the normal update path, which snapshots a NEW version, so
  history stays append-only and an eval scored against v3 still points at the
  text it scored. *Diff* is Coming soon — the repo's `DiffViewer` is built for
  file patches, not two markdown blobs.

**`/skills/[id]`** stays as a deep-linkable route (bookmarks, links from an
agent's Skills tab) but renders the very same `SkillDetail`, so tabs, editor,
and version history have exactly one implementation.

**Import drawer (`AddSkillDrawer`)**
- Single panel (no tabs — scope is file/archive only), native
  `<input type="file" accept=".md,.markdown,.zip">` behind a styled label, no
  drag-and-drop library.
- Selecting a file calls `useImportSkillPreview`; the response (`SkillDraft`)
  renders in the *same* field set as the editor, fully editable, plus
  `source_entry` ("Extracted from `skills/…/SKILL.md`") and the untrusted
  notice. Nothing is persisted at this point.
- Confirming calls `useCreateSkill` with `source: 'imported_url'` and
  `evidence_files: [source_entry]`; the server forces `enabled: false`
  regardless of what the form shows. A 422 (bad extension, no markdown in
  archive) renders inline in the drawer, not a fire-and-forget toast.

**Agent editor — Skills tab**
- New tab alongside the existing Config tab (`VALID_TABS = ["config",
  "skills"]`); both tabs keep `key={agent.id}`.
- Two sections: Linked (ordered, ▲/▼ + remove) and Available (filterable).
  Order changes only via the ▲/▼ buttons (no drag-and-drop dependency in the
  project); ▲ disabled on the first item, ▼ on the last, both carry
  `aria-label`s for the RTL role queries.
- Local `string[]` state, one explicit Save → `useSetAgentSkills` with the
  full ordered `skill_ids` array (the server semantics replace the whole set;
  nothing is sent per arrow click).
- A linked-but-disabled skill is visually muted with a badge explaining it
  will not reach the prompt — otherwise a user sees it in the list while the
  trace shows no such block, which is confusing.

## API

Consumes `server/README.md`'s Skills section: `GET/POST /skills`,
`GET/PUT/DELETE /skills/:id`, `GET /skills/:id/versions(/:version)`,
`POST /skills/import/preview` (multipart), `GET/POST /agents/:id/skills`,
`GET /agents/skill-counts`.

`apiFetch` (`src/lib/api.ts`) needed one change to support this: it no longer
forces `content-type: application/json` when `init.body instanceof FormData`
(the browser must set its own multipart boundary), and a new `api.postForm`
helper wraps that. All access still goes through `src/lib/hooks/skills.ts` —
no component calls `fetch` directly.

## Rejected alternatives

- **Drag-and-drop reordering** — no DnD library in the project; pulling one
  in for a single ▲/▼ list was judged not worth the dependency.
- **react-hook-form for the editor** — not used anywhere else in the client;
  a manual `useState` + explicit Save matches every other editor
  (`ConfigTab` included).
- **Wiring the `fromUrl` menu entry** — the copy key exists in `skills.json`
  but nothing behind it is built; a menu item that 404s is worse than an
  unused i18n key. `community` *is* wired, but to a Coming soon drawer: it is
  part of the intended Add Skill flow, and a dead menu row reads as a bug.
- **Sample data on Evals/Stats** — rendering "17 / 20 passing" or "71% pull"
  against hardcoded values would make the product look like it measures things
  it does not. Both tabs state what they will measure instead.
- **Sidebar items for unbuilt surfaces** (Eval Dashboard, Memory, CI Runs, …)
  — `NAV` gained a `SKILLS LAB` section, but only routes that exist are
  listed. Nav is a promise that a click goes somewhere.
- **`?tab=` for the detail pane** — see above: Back would undo a tab switch
  instead of leaving the page.
- **Toast-only import errors** — a 422 from `/skills/import/preview` renders
  inline in the drawer instead, since the user needs to see and fix the
  specific reason before retrying, not chase a dismissed toast.

## Acceptance

- [x] `/skills` shows loading/error/empty/populated states and a working
      search/filter, with empty-library and no-match treated separately.
- [x] Clicking a card opens the in-page detail pane, never a route navigation.
- [x] Filtering the list does not blank the skill being edited (tested).
- [x] All five tabs render; Evals and Stats state Coming soon (tested), as do
      Run on evals, version Diff, and the community drawer.
- [x] The description-hint caption is present under `description` in the
      editor (tested).
- [x] The body strip shows the filename, a token estimate, and an `unsaved`
      badge that appears only once the body diverges from the saved skill
      (tested).
- [x] Saving a body edit shows the bumped version chip.
- [x] Restoring an old version appends a new version rather than rewinding.
- [x] `/skills/[id]` and `/skills` share one `SkillDetail` implementation.
- [x] The import drawer never calls `useCreateSkill` before the user clicks
      Save on the previewed draft (tested).
- [x] An imported skill lands with `enabled: false` and a "needs vetting"
      chip, matching the server's forced gate.
- [x] The agent editor's Skills tab reorders via ▲/▼ only, saves the full
      `skill_ids` array once per explicit Save, and visually flags a linked
      but disabled skill.
- [x] `AgentCard`'s `skillCount` prop is wired to real data
      (`useAgentSkillCounts`).
- [x] `pnpm typecheck`, `pnpm test` (88 tests), `pnpm lint` (0 errors), and
      `pnpm build` pass.

## Risks

1. **No live model experiment is provable from this UI alone** — this spec
   covers CRUD/import/linking; whether a skill measurably changes a review's
   output is a manual, model-dependent check the user runs separately.
2. **The `fromUrl` copy key stays unused** — if a future wave adds that import
   path, wire the existing key rather than adding a new one.
3. **Four surfaces are Coming soon** (Evals, Stats, the card stats strip, the
   community drawer) and each needs backend work first: an eval runner + case
   store, and review telemetry recording which skills actually reached the
   prompt. Until then the UI must keep stating that, not simulating it.
4. **The token count is an estimate** (~4 chars/token). If a body is ever
   rejected for length server-side, the number shown here will not be the
   number that was enforced — surface the server's count when one exists.
3. **RTL tests for `*ListView` pages under `AppShell`** needed mocking both
   `@/components/app-shell` and `next/navigation` together — no prior test in
   the repo rendered a real `AppShell`; documented in `client/INSIGHTS.md` so
   the next similar page doesn't rediscover it.
