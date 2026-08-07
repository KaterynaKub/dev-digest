# 0005 — Smart Diff (split into 0005a / 0005b / 0005c)

**Status:** superseded by 0005a, 0005b, 0005c
**Date:** 2026-08-06
**Touches:** nothing — this file is a pointer only

---

## Do not implement this file

This spec was rewritten and split into three self-contained parts so the work
can be executed in three independent passes. **Read one of these instead:**

| Part | File | Scope |
|---|---|---|
| A | [`0005a-smart-diff-server.md`](./0005a-smart-diff-server.md) | The contract (`SmartDiffFindingMark` + `finding_marks` / `finding_count` / `is_large`, **both vendored copies, edited once**) and the whole `modules/smart-diff` server module: constants, helpers, repository, service, routes, container wiring, three test files. |
| B | [`0005b-smart-diff-client.md`](./0005b-smart-diff-client.md) | `useSmartDiff`, the `smartDiff` message block, and the `SmartDiffSection` component — including the **"Large" file badge** and the **two-level expansion** (groups `core`/`wiring` open, `boilerplate` always closed; files open only when they carry findings). |
| C | [`0005c-smart-diff-navigation.md`](./0005c-smart-diff-navigation.md) | **Cross-tab navigation**: clicking a finding badge in the Smart Diff routes to `?tab=findings&finding=<id>` and focuses that finding's `FindingCard` inside its review-run accordion. Plus the closing documentation and stale-prose sweep. |

Each part carries its own Prerequisites block with a one-command check, its own
architectural constraints, verification plan, and acceptance checklist. They are
meant to be read alone — nothing in this file is needed to implement any of them.

Order: **A → B → C.** The contract is edited exactly once, in part A.

---

## What changed relative to the original single-file plan

Three requirement mismatches were corrected in the rewrite. Recorded here
because the original text argued explicitly for two of the wrong behaviours, and
a reader who remembers it should know it was overruled.

1. **Navigation to the finding card was listed as out of scope.** The original
   delivered only a `scrollIntoView` within the Smart Diff section and put
   cross-tab navigation under *Out of scope*. The requirement is the opposite:
   a click must land on the finding's card in the tab that holds the agent
   runs, through standard routing — no popup, no GitHub link, no scroll to the
   top of a file. This is now the whole of part C, and part A's contract carries
   `finding_id` + `review_id` on every mark to make it possible.
2. **The large-file highlight was missing entirely.** The original had
   `split_suggestion` (whole-PR size) and `MAX_BARREL_LINES` (classification),
   which are different things. Part A adds `LARGE_FILE_LINES_THRESHOLD` and an
   `is_large` field; part B renders a "Large" badge plus an amber card border.
3. **Group-level expansion did not exist, and empty groups were to be hidden.**
   The original had file-level defaults only and proposed skipping empty groups
   in the UI — which contradicts grouping every file into three categories.
   Part B specifies two independent levels (group: `core`/`wiring` open,
   `boilerplate` always closed; file: open iff it has findings) and three
   permanently-rendered group sections.
