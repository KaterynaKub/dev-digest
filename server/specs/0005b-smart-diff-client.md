# 0005b — Smart Diff · Part B (client)

**Status:** done
**Date:** 2026-08-06
**Touches:** client/src/lib/hooks/reviews.ts · client/messages/en/prReview.json · client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffSection (new) · .../\_components/DiffTab/DiffTab.tsx

Part B of three: **0005a** contract + server module · **0005b** client component ·
**0005c** navigation to the finding card + doc sweep. Each is self-contained.

---

## Prerequisites

Part A must be done. Verify with one command:

```
cd server && pnpm exec vitest run smart-diff
```

Must pass. Also confirm the contract landed on both sides:

```
cd server && diff src/vendor/shared/contracts/brief.ts ../client/src/vendor/shared/contracts/brief.ts
```

Must print **nothing**, and `SmartDiffFile` must already carry `finding_marks`,
`finding_count`, and `is_large`. **Part B does not edit the contract** — if a
field is missing, finish part A first.

---

## Summary

Part B renders the reviewer-ordered diff: a "REVIEWER-ORDERED DIFF" section above
the existing file list, with a Smart order / Original order toggle, three role
groups, per-line severity marks, and a Large badge on oversized files.

The endpoint is already deterministic and makes no model call — part B adds no
new data source, only a `useQuery` over it.

Scope: one hook, one messages block, one component folder (5 files), one edit to
`DiffTab`.

---

## Baseline (judge by delta)

- `client` lint: **0 errors, 3 pre-existing warnings**.
- `client` tests: 108 in 22 files.
- `client` has **no `arch:check`** — the constraints below are the gate.
- Never pipe a check into `tail`/`head` — `$?` becomes `tail`'s status and a
  failure reads as success.

---

## Constraints

1. **No `fetch` in the component.** All HTTP goes `src/lib/api.ts` →
   `src/lib/hooks/reviews.ts` → component.
2. **Tailwind is not used in this repo.** Styling is inline `style={{...}}` from
   objects in a sibling `styles.ts`, using CSS variables from
   `client/src/vendor/ui/styles.css`. No CSS modules, no `styled`.
3. `client/CLAUDE.md` **overrides** the `ui-frontend-architecture` skill's
   `src/features/*` canon — there is no `src/features/` here and none is to be
   created. Feature logic is colocated in `_components/<Name>/`.
4. The folder ships exactly five files: `SmartDiffSection.tsx`, `constants.ts`,
   `styles.ts`, `index.ts`, `SmartDiffSection.test.tsx`. The neighbouring
   `IntentCard/` has no test despite spec 0004 requiring one — that is a gap, not
   a precedent.
5. **Border properties longhand** (`borderStyle`/`borderWidth`/`borderColor`)
   wherever `is_large` changes the colour — bo mixing the `border` shorthand with
   a conditional `borderColor` silently loses one of them in React's style
   merging.
6. All user-facing strings from `messages/en/prReview.json`'s `smartDiff` block —
   **which already exists and is unused**; extend it, do not create a parallel
   one. No inline JSX copy, including group captions and toggle labels.
7. **Every async region shows a loader**: `Skeleton` plus a named `role="status"`
   line. No mutation here, so no `loading={isPending}` button.
8. Types come from `@devdigest/shared`; never re-declare `SmartDiff`.
   `client/src/lib/types.ts:36` already re-exports it.
9. **`CRITICAL` → "blocker" is a display mapping only.** The wire, the DB, and
   every type keep `CRITICAL`/`WARNING`/`SUGGESTION`. The label lives in
   `messages/` and nowhere else. Do not add `blocker` to any enum.
10. **`pseudocode_summary` is not rendered** — no "What this does" block, no
    "summary" badge, even if the API ever returns the field. A deliberate
    deviation from the mockup; put it in the component's header comment so the
    next reader does not "restore" it.
11. `is_large` is **not recomputed** on the client — the server owns the
    threshold (`smart-diff/constants.ts#LARGE_FILE_LINES_THRESHOLD = 300`), bo
    two thresholds would drift.

---

## Two-level expansion (hard requirement)

Two **independent** levels, both computed in a `useState` initialiser, never
synced in an effect:

- **Group level** — `core` and `wiring` open, `boilerplate` **always closed**,
  from `GROUP_DEFAULT_OPEN` in `constants.ts`.
- **File level** — a file is open when `finding_count > 0`, else closed. Do not
  use `AUTO_EXPAND_MAX_LINES` here.

So inside an open `wiring` group, two files sit collapsed and the one with a
blocker is expanded — exactly the mockup.

**All three group headers always render, including a group with zero files.** The
API guarantees three groups in a fixed order precisely so the UI has three stable
sections; an empty "Boilerplate — 0 files" header is not noise, it is the
confirmation that nothing was hidden. An open group with no files shows a single
muted line. **Do not filter empty groups out** — and do not open `boilerplate`
even when it is the only non-empty group, bo the requirement is literal.

---

## Implementation steps

### Step 0 — Record the baseline

`cd client && pnpm lint` (0 errors / 3 warnings) and `pnpm test` (108 in 22).

### Step 1 — Hook + messages

**Files:** `client/src/lib/hooks/reviews.ts`, `client/messages/en/prReview.json`.

Hook, matching `useIntent`'s style (`reviews.ts:141-147`):
```ts
/** Deterministic reviewer-ordered diff. Pure server computation — no model
 *  call, nothing persisted, so it is safe to refetch freely. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
```
Import `SmartDiff` as a **type** from `@devdigest/shared`.

Invalidate `["smart-diff", prId]` in `useRunReview`'s `onSuccess` beside the
existing `["reviews", prId]` — bo a finished review changes which lines are
marked, and without this the section shows the previous run's marks until reload.

Messages — **extend** the existing `smartDiff` block (`prReview.json:81-90`,
which already has `coreLabel`, `wiringLabel`, `boilerplateLabel`, `largeTitle`,
`largeBody`, `filesCount`, `findingLines`, `groupedByRole`). Add: `title`
("REVIEWER-ORDERED DIFF"), `smartOrder`, `originalOrder`, `stats`
("{files} files · +{additions} -{deletions}"), `coreCaption` ("The substance of
the change — review closely"), `wiringCaption` ("Hooks the core into the app"),
`boilerplateCaption` ("Generated / mechanical — skim"), `findingsBadge`
("{count} findings"), `largeBadge` ("Large"), `emptyGroup`, `loading`, `error`,
`empty`, and `severityLabel.CRITICAL` = **"blocker"** / `.WARNING` = "warning" /
`.SUGGESTION` = "suggestion".

### Step 2 — `SmartDiffSection`

**Files:** the folder's four non-test files (new), `DiffTab/DiffTab.tsx` (edit).

`"use client"`. Props: `{ prId: string | null; files: PrFile[]; order: "smart" |
"original"; onOrderChange: (o) => void }`. `files` comes from the already-fetched
`PrDetail` and carries the `patch` text; the hook supplies only ordering and
marks. Look up each `SmartDiffFile` against `files` by `path`; a path present in
the smart diff but missing from `files` renders its header with an empty body
rather than throwing.

**Reuse, do not reimplement:** `parsePatch` and `type Line` from
`@/components/diff-viewer/helpers`, `lineRowFor`/`lineSignFor` from
`@/components/diff-viewer/styles`. These are **deep imports** — the barrel
exports only `DiffViewer` and `type DiffCommentApi`. Deliberate and acceptable
(the alternative is widening a shared component's public surface for one
consumer); note it in the header comment. Do **not** write a second patch parser,
and do **not** modify `CodeLine`, `FileCard`, or `DiffViewer` — `CodeLine` takes
`threads` and `commenting` and is built for the GitHub-comment surface.

**Layout — use these values, do not invent.** All colours are existing CSS
variables; all styling inline from `styles.ts`.

- **Section header** — reuse `SectionLabel` (`vendor/ui/primitives/SectionLabel.tsx`):
  it already renders `icon` at 14px in `--text-muted` plus an uppercase 12px /
  weight 700 / `letterSpacing: "0.07em"` label and a `right` slot. Pass
  `icon="Code"` and `t("smartDiff.title")`. No new styles needed.
- **Stats + toggle row** — `display: flex, alignItems: center, gap: 12,
  marginBottom: 12`.
  - Left: `fontSize: 12`, `className="mono tnum"`, `color: "var(--text-muted)"`.
    `+247` in `var(--code-add-text)`, `-38` in `var(--code-del-text)` — the same
    tokens `diff-viewer/styles.ts` uses, so the numbers match the diff below.
    Two spans need different colours, so render with `t.rich("smartDiff.stats",
    { add: …, del: … })` rather than concatenating in JSX.
  - Right (`marginLeft: "auto"`): wrapper `display: inline-flex, padding: 2,
    gap: 2, borderRadius: 6, border: "1px solid var(--border)", background:
    "var(--bg-surface)"` holding two `<button type="button">`, each `padding:
    "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 4, border: "none",
    cursor: "pointer"`. Active: `background: "var(--bg-hover)", color:
    "var(--text-primary)"`. Inactive: `background: "transparent", color:
    "var(--text-muted)"`. Wrapper `role="group"`, each button
    `aria-pressed={isActive}` — with no `ToggleGroup` primitive in the repo,
    `aria-pressed` is what makes the state readable to a screen reader and
    testable by RTL.
- **Group section — all three, always**, in the order the API sends them.
  - Header row: `display: flex, alignItems: center, gap: 8, padding: "10px 2px
    6px", cursor: "pointer"`, and it **is** the group's toggle: `role="button"`,
    `tabIndex={0}`, `aria-expanded={open}`, plus the Enter/Space `onKeyDown`
    handler from `ReviewRunAccordion.tsx:82-84`.
  - Chevron: `<Icon.ChevronRight size={13} />` with the rotation idiom from
    `diff-viewer/styles.ts#chevronFor` — `transform: open ? "rotate(90deg)" :
    "none", transition: "transform .12s", color: "var(--text-muted)"`.
  - Colour chip: `width: 8, height: 8, borderRadius: 2` (a square), background
    per role — `core` → `var(--accent)`, `wiring` → `var(--warn)`,
    `boilerplate` → `var(--text-muted)`. Map in `constants.ts` as `ROLE_COLOR`.
  - Name: `fontSize: 13, fontWeight: 600, color: "var(--text-primary)"`.
    Caption: `fontSize: 12, color: "var(--text-muted)"`. Right
    (`marginLeft: "auto"`): `t("smartDiff.filesCount", { count })`, `fontSize:
    12, color: "var(--text-muted)"`, `className="tnum"`.
  - Open per `GROUP_DEFAULT_OPEN`. Open-and-empty → one line at `fontSize: 12,
    color: "var(--text-muted)", padding: "6px 2px"` with `t("smartDiff.emptyGroup")`.
- **File card** — reuse the visual language of `diff-viewer/styles.ts`'s
  `fileCard`/`fileHeader` so both lists look like one surface. Longhand borders
  (constraint 5):
  ```ts
  fileCard: (isLarge: boolean): CSSProperties => ({
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: isLarge ? "var(--warn)" : "var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  }),
  ```
  Header: `display: flex, alignItems: center, gap: 10, padding: "10px 12px",
  cursor: "pointer"`, with `role="button"`, `tabIndex={0}`,
  `aria-expanded={open}` and the same Enter/Space handler.
  - Chevron: same idiom. File icon: `<Icon.FileText size={14} style={{ color:
    "var(--text-muted)" }} />`.
  - Path: `className="mono"`, `fontSize: 13, fontWeight: 500, flex: 1, minWidth:
    0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"` — the
    `minWidth: 0` is required or the ellipsis never appears (`client/INSIGHTS.md`).
  - **Large badge**: when `is_large`, a `<Badge>` with `color="var(--warn)"`
    `bg="var(--warn-bg)"` and `t("smartDiff.largeBadge")`, between the path and
    the findings badge, `flexShrink: 0`. **Mandatory whenever the amber border
    is applied** — colour is never the only carrier of meaning.
  - Findings dot: when `finding_count > 0`, a `width: 6, height: 6, borderRadius:
    99` dot in the file's **worst** severity colour (`SEVERITY_COLOR` in
    `constants.ts`: `CRITICAL` → `var(--crit)`, `WARNING` → `var(--warn)`,
    `SUGGESTION` → `var(--sugg)`), followed by `t("smartDiff.findingsBadge",
    { count })` at `fontSize: 12` in the same colour.
  - Stats: `className="mono tnum"`, `fontSize: 12`, `+N` in
    `var(--code-add-text)`, `−N` in `var(--code-del-text)`, `flexShrink: 0`.
- **Expanded body** — `borderTop: "1px solid var(--border)", padding: "8px 0",
  background: "var(--bg-surface)"`. Render `parsePatch(file.patch)` through a
  local `SmartDiffLine`:
  - base row `lineRowFor(ln.kind)` (already gives added lines
    `var(--code-add)`, deleted `var(--code-del)`);
  - gutter `width: 44, textAlign: "right", padding: "0 10px 0 0", color:
    "var(--text-muted)", userSelect: "none", flexShrink: 0`; sign span
    `lineSignFor(ln.kind)`; text `flex: 1, whiteSpace: "pre-wrap", wordBreak:
    "break-word", color: "var(--text-primary)", paddingRight: 12` — i.e.
    `s.lineNo`/`s.lineText` from `diff-viewer/styles.ts`, **copied** into this
    component's `styles.ts` rather than imported, bo they are plain objects and
    copying keeps the shared module's surface unchanged;
  - a marked line gets `borderLeftStyle: "solid", borderLeftWidth: 2,
    borderLeftColor: <severity colour>` (longhand) and a `<Badge>` at the right
    with `color`/`bg` from the severity token pair (`--crit`/`--crit-bg`,
    `--warn`/`--warn-bg`, `--sugg`/`--sugg-bg`), `icon="Lightbulb"` for
    `SUGGESTION`, and the label from `t("smartDiff.severityLabel.<SEVERITY>")` —
    so `CRITICAL` renders **"blocker"**. Match on `ln.newNo`, bo marks come from
    `start_line`, a new-side line number.
  - **The mark badge is a plain `<Badge>` in part B** — part C turns it into a
    navigating button. Do not build navigation here, but **keep the mark object
    in scope at the badge's render site** so part C has `finding_id` where it
    needs it, and give each marked row `id={`sd-${path}-${line}`}`.
- **States**: loading → `Skeleton` + `role="status"` with `t("smartDiff.loading")`;
  error → inline `t("smartDiff.error")` **with the original `DiffViewer` still
  rendered below**, so a failure degrades to today's behaviour rather than an
  empty tab; no files → `t("smartDiff.empty")`.
- **Split suggestion**: when `too_big`, a callout above the groups using the
  existing `largeTitle`/`largeBody` messages (`largeTitle` takes `{lines}` — pass
  `total_lines`), listing `proposed_splits` as `name` + file count. `border: "1px
  solid var(--border)", borderRadius: 7, padding: "12px 14px", background:
  "var(--warn-bg)", color: "var(--text-primary)", fontSize: 13`. This is the
  **PR-level** callout and is unrelated to the per-file `is_large` badge —
  `too_big` counts reviewable lines across the PR, `is_large` is one file's churn.
  Say so in a comment; they will otherwise be "unified" later.
- **`DiffTab.tsx` owns the order state**: `const [order, setOrder] =
  React.useState<"smart" | "original">("smart")`, renders `<SmartDiffSection …
  order={order} onOrderChange={setOrder} />` above the existing `SectionLabel` +
  `DiffViewer` block, and renders that block only when `order === "original"`.
  **Do not delete the existing `DiffViewer` path** — it carries the inline-comment
  feature (`DiffTab.tsx:26-41`), which this section deliberately does not
  reimplement.

### Step 3 — Client test

**File:** `SmartDiffSection.test.tsx`. RTL + Vitest, following
`FindingCard.test.tsx`: wrap in `NextIntlClientProvider` with `{ prReview:
messages }` from `messages/en/prReview.json`, plus a `QueryClientProvider`. Mock
the hook module (`vi.mock("@/lib/hooks/reviews", …)`) rather than the network —
the component must never be tested against a real `fetch`.

Named tests for:
- loading renders `role="status"`;
- **all three group headers render, including a zero-file group**;
- **`core` and `wiring` open, `boilerplate` collapsed** — assert on
  `aria-expanded`, not on inline styles;
- **`boilerplate` stays collapsed even when it is the only non-empty group**;
- inside an open group, a file with findings is expanded and one without is not;
- a `CRITICAL` mark renders **"blocker"**, not "critical";
- `is_large` renders the Large badge; a normal file does not;
- clicking "Original order" flips `aria-pressed`;
- **no "What this does" text and no "summary" badge even when the fixture sets
  `pseudocode_summary`**;
- the error state renders `smartDiff.error`.

Expected delta: 23 test files, 108+N tests.

---

## Verification

| When | Command | From | Pass criterion |
|---|---|---|---|
| step 0 | `pnpm lint`, `pnpm test` | `client/` | record 0/3 and 108 in 22 |
| after 1 | `pnpm typecheck && pnpm lint` | `client/` | exit 0, no new warnings |
| after 2 | `pnpm typecheck && pnpm lint` | `client/` | exit 0, no new warnings |
| after 3 | `pnpm test` | `client/` | all pass; the 108 still green |
| after 3 | `pnpm build` | `client/` | exit 0 — catches the `extensionAlias` failure class that `tsc --noEmit` misses when a contract **value** is first imported (`client/INSIGHTS.md`) |
| after 3 | `diff ../server/src/vendor/shared/contracts/brief.ts src/vendor/shared/contracts/brief.ts` | `client/` | **empty** — part B must not have touched the contract |

---

## Acceptance

- [ ] All three group headers render on every PR, including empty groups.
- [ ] `core` and `wiring` open by default; `boilerplate` collapsed **always**,
      including when it is the only non-empty group. Two tests, on `aria-expanded`.
- [ ] Both expansion defaults computed in a `useState` initialiser, not an effect.
- [ ] A file with findings is expanded; one without is collapsed.
- [ ] `is_large` files show the **Large badge and** the amber border — never the
      border alone.
- [ ] A marked line shows a coloured left stripe **and** a badge with a text
      label; `CRITICAL` reads **"blocker"**, from `messages/` only.
- [ ] The toggle switches between the reviewer ordering and the existing
      `DiffViewer`; the inline-comment path is unchanged.
- [ ] Loading shows `Skeleton` + `role="status"`; the error state still renders
      the original file order below.
- [ ] No "What this does" block and no "summary" badge — asserted by a test.
- [ ] Every string from `messages/`; no inline JSX copy.
- [ ] No `fetch` in the component; no contract edit in this part.
- [ ] `cd client && pnpm build` exits 0.

---

## Out of scope for part B

Navigation from a mark to the finding's card (part C) · inline commenting inside
the reviewer-ordered list — comments stay on the original-order `DiffViewer` ·
persisting the toggle choice · `pseudocode_summary` in any form · localisation
beyond `en`.

## Open questions

- Does "9 files · +247 -38" count all files or only reviewable ones? **Assumed
  all**, matching GitHub's own header and `PrDetail.files_count`, so the two
  numbers on the page agree. Note this differs from `too_big`, which counts only
  reviewable lines — the two answer different questions.
- Should the toggle choice persist (URL param / localStorage)? **Assumed no** —
  component state defaulting to Smart order, bo the tab is already URL-encoded
  and a second param for a display preference was not asked for.
- The group chips map "blue / amber / grey" to `--accent`, `--warn`,
  `--text-muted` — the closest existing tokens, no new CSS variable. A different
  blue is one value in `constants.ts#ROLE_COLOR`.
