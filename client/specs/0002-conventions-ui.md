# 0002 — Conventions UI

**Status:** done
**Date:** 2026-08-04
**Touches:** src/app/conventions · src/lib/hooks/conventions.ts · src/vendor/ui/nav.ts · messages/en/conventions.json

## Problem

The server can extract grounded code conventions
(`../server/specs/0002-conventions-extractor.md`), but there is no surface to
run a scan, review what came back, or turn the good ones into a Skill. The
i18n namespace and the nav-key mapping for `/conventions` already existed with
nothing behind them.

## Approach

A `/conventions` route under Skills Lab, between Agents and the rest. The route
is NOT `:repoId`-scoped — it resolves the repo from `useActiveRepo()`, matching
what `activeKeyFor()` already assumed.

- `ConventionsView` — header (repo name + model picker + Re-scan), a subtitle
  built from the scan row, a bulk bar, the candidate list, and the two modals.
- `ConventionCard` — category badge, rule, `EvidenceBlock`, confidence bar, and
  the accept/edit/reject column.
- `EvidenceBlock` — `path:start-end` strip with a copy button over the snippet.
- `EditConventionModal` — the "Edit first" step.
- `ScanModelPicker` — per-scan model choice.
- `CreateSkillFromConventionsModal` — the merged draft, editable, saved via the
  existing `useCreateSkill`.

## Rejected alternatives

- **Editing a candidate inline.** The card already carries rule + evidence +
  confidence + three buttons; an inline textarea reflows the whole list and
  fights the code block for width. "Edit first" also reads as a step, not an
  in-place mutation.
- **Removing rejected cards from the DOM.** "Reject all" would then look like
  data loss. They stay at reduced opacity with an Undo.
- **A working Enabled toggle in the create-skill modal.** `POST /skills` forces
  `enabled: false` for `source: 'extracted'`. Options were: a second
  `PUT /skills/:id` right after create, or a read-only toggle. The follow-up
  PUT would technically honour the toggle, but it routes around a gate whose
  entire purpose is that imported content is not live until a human enables it
  in Skills Lab — so the toggle is read-only and the hint says where to flip it.
- **A provider selector next to the model picker.** OpenRouter is the only
  provider with a live priced model list, which is what makes "pick a cheap
  model" a real choice. A second control would double the state for nothing.
- **Persisting the per-scan model to settings.** A one-off experiment with an
  expensive model would silently become the workspace default.

## Acceptance

- [x] Sidebar shows Conventions under Skills Lab, `g c` navigates to it.
- [x] Loading / error / empty states render; the empty CTA runs a scan.
- [x] The subtitle reports the scan's sample count, age, and model.
- [x] Accept / reject / edit / undo each hit the right mutation.
- [x] "Accept all (N)" counts only pending candidates.
- [x] "Create skill" appears only once something is accepted.
- [x] The model picker seeds from the workspace override, else the registry
      default (tagged), and degrades to a note when no model list is available
      — without blocking Re-scan.
- [x] The create-skill modal pre-fills from the draft, counts tokens live, and
      shows Enabled as read-only with an explanation.

## Risks

- The picker assumes OpenRouter. A workspace whose `feature_models.conventions`
  override names an OpenAI model will show that id in the list (it is prepended
  when absent) but scans dispatch through OpenRouter. Acceptable while the
  cheap tier is OpenRouter-only; revisit if another provider gains live pricing.
