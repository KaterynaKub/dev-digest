# 0005c — Smart Diff · Part C (navigation + sweep)

**Status:** done
**Date:** 2026-08-06
**Touches:** client/src/app/repos/[repoId]/pulls/[number]/page.tsx · .../\_components/{FindingsTab,ReviewRunAccordion,FindingsPanel,DiffTab,SmartDiffSection} · client/messages/en/prReview.json · server/src/modules/index.ts (comment) · server/src/modules/pulls/CLAUDE.md

Part C of three: **0005a** contract + server module · **0005b** client component ·
**0005c** navigation to the finding card + doc sweep. Each is self-contained.

---

## Prerequisites

Parts A and B must be done. Verify:

```
cd client && pnpm test
```

`SmartDiffSection.test.tsx` must pass. The Smart Diff section must render marked
lines with severity badges, and `SmartDiffFindingMark` must carry `finding_id`
and `review_id` (part A) — part C navigates by those ids and cannot work without
them.

---

## Summary

Clicking a severity badge in the Smart Diff must land the reviewer on **that
finding's card** in the Findings tab.

**Not a popup. Not a modal. Not a GitHub deep-link. Not a scroll to the top of
the file.** Standard app routing: `?tab=findings&finding=<id>` via
`router.replace`, mirroring the existing `?trace=` param.

The mechanism mostly exists — this part adds a second driver to it rather than
building new infrastructure.

---

## What exists, and the three real gaps

| Piece | Where | State |
|---|---|---|
| `setParam(key, val)` | `page.tsx:62-67` | writes one query param via `router.replace`, preserving others |
| `?trace=` precedent | `page.tsx:61,173-181` | a query param addressing one entity — the form to mirror |
| card anchor + highlight | `FindingCard.tsx:55` | **already has** `data-finding-id={f.id}` and a `focused` prop feeding `s.card(...)` |
| accordion targeting | `FindingsTab.tsx:79-82,195-196`, `ReviewRunAccordion.tsx:49-59` | `targetRunId`/`targetNonce` + nonce idiom; an effect opens and scrolls the accordion |

**`FindingCard` is not modified** — the anchor and the highlight are already
there. The gaps are upstream:

1. **`ReviewRunAccordion` opens only by *run*.** Its effect fires on
   `review.run_id === targetRunId`, and `reviews.run_id` is **nullable**
   (`review-api.ts:27`). It needs a `targetFindingId` whose condition is
   *finding membership* — bo that also makes an older run's accordion open even
   though `defaultOpen={i === 0}` (`FindingsTab.tsx:189`) left it closed.
2. **`FindingsPanel` cannot be told which card to focus.** `focusIdx` is a local
   `useState(0)` moved only by `j`/`k` keypresses (`FindingsPanel.tsx:29`).
3. **The `hideLow` filter can swallow the target.** `FindingsPanel.tsx:28,31`
   filters low-confidence findings out of `shown`; if the target is among them,
   the focus lands nowhere.

---

## Baseline (judge by delta)

- `client` lint: 0 errors, **3 pre-existing warnings**; tests 108 + part B's, in
  23 files; typecheck exits 0.
- `server` typecheck: **2 pre-existing errors** (`db/migrate.ts:38`,
  `db/seed.ts:499`); `arch:check` **6 warnings, 0 errors** and **exits 0 even
  with violations** — judge by the summary line.
- Never pipe a check into `tail`/`head` — `$?` becomes `tail`'s status.
- **jsdom does not implement `scrollIntoView`** — any test touching this path
  throws unless `Element.prototype.scrollIntoView` is stubbed with `vi.fn()`.

---

## Constraints

1. **Standard routing only.** `router.replace` via `URLSearchParams`. No
   `window.open`, no modal, no drawer, no `github.com` link.
2. New props on existing components are **optional with defaults**, so every
   current caller keeps compiling and existing tests need no edits.
3. `FindingCard` is not modified (one debatable exception in Step 1 —
   `scrollMarginTop`; pick a side and comment it).
4. The Timeline → Review-runs path (`RunHistory` → `handleGoToReview`) must keep
   working unchanged — it is a second driver of the same state.
5. All strings from `messages/en/prReview.json`; longhand border properties in
   any style object a condition touches.

---

## Implementation steps

### Step 0 — Record the baseline

`cd client && pnpm typecheck && pnpm lint && pnpm test`; `cd server && pnpm
arch:check && pnpm typecheck`. Write the numbers down.

### Step 1 — `FindingsPanel`: focus a finding by id

**File:** `.../FindingsPanel/FindingsPanel.tsx`.

Add optional `targetFindingId?: string | null` and `targetNonce?: number`
(defaults `null` / `0`).

Add a `containerRef` on the list `<div style={s.list}>` (`FindingsPanel.tsx:57`)
so the scroll query is **scoped to this panel** — bo several accordions can be
open at once (`defaultOpen={i === 0}` plus the user's clicks) and an unscoped
`querySelector` would grab a sibling's card.

One effect keyed on `[targetFindingId, targetNonce, findings]`:
1. return if `targetFindingId` is null;
2. return if `!findings.some(f => f.id === targetFindingId)` — this panel does
   not own the target;
3. if the target is not in `shown`, `setHideLow(false)` and return — the effect
   re-runs when `shown` changes and completes on the second pass. Compute
   membership from the same `visibleFindings(findings, hideLow)` the render uses;
   do not reimplement the filter. Comment it: *a reviewer who clicked this
   finding in the Smart Diff asked for it explicitly — a display filter must not
   silently swallow the target*;
4. `setFocusIdx(shown.findIndex(f => f.id === targetFindingId))` — recompute from
   the id whenever `shown` changes rather than storing a bare index, bo a refetch
   would otherwise leave the index pointing at the wrong card;
5. `containerRef.current?.querySelector(`[data-finding-id="${targetFindingId}"]`)`
   → `scrollIntoView({ behavior: "smooth", block: "center" })`. Guard null
   silently.

Add `scrollMarginTop: 16` so the smooth scroll does not tuck the card under the
sticky header — `ReviewRunAccordion.tsx:75` does this for the same reason. Either
in `FindingCard/styles.ts:5-19` (the one exception to "FindingCard untouched") or
on `FindingsPanel`'s list items. **Pick one and comment it.**

Change `defaultExpanded` at `FindingsPanel.tsx:66` from `i === 0` to
`i === 0 || f.id === targetFindingId` — an *initial* value only; it will not
reopen a card the user closed, which is the documented limit.

**Done when:** typecheck + lint clean; the existing `FindingsPanel.test.tsx`
passes **unedited** (the new props are optional).

### Step 2 — `ReviewRunAccordion`: open on finding membership

**File:** `.../ReviewRunAccordion/ReviewRunAccordion.tsx`.

Add `targetFindingId?: string | null` (default `null`). Widen the effect
(`ReviewRunAccordion.tsx:54-59`) to fire when **either** `review.run_id &&
review.run_id === targetRunId` (unchanged Timeline path) **or** `targetFindingId
&& review.findings.some(f => f.id === targetFindingId)`. Add `targetFindingId`
and `review.findings` to the deps.

Pass `targetFindingId` and `targetNonce` through to `<FindingsPanel>`
(`ReviewRunAccordion.tsx:159-164`). Update the prop doc comment
(`ReviewRunAccordion.tsx:47-50`) — it says the target is "driven from the
Timeline"; there are now two drivers.

### Step 3 — `FindingsTab`: widen the target, accept the prop

**File:** `.../FindingsTab/FindingsTab.tsx`.

Widen the state (`FindingsTab.tsx:79`):
```ts
const [target, setTarget] = React.useState<{
  runId: string | null; findingId: string | null; n: number;
} | null>(null);
```
`handleGoToReview(runId)` keeps its exact signature — `RunHistory.tsx:188` calls
it with a run id and nothing else — and now sets `{ runId, findingId: null,
n: prev+1 }`.

Add props `targetFindingId?: string | null` and `targetFindingNonce?: number`,
and one effect keyed on **both** that sets `{ runId: null, findingId:
targetFindingId, n: (p?.n ?? 0) + 1 }`. Keying on both is what lets a repeat
click on the same badge re-fire — an unchanged prop alone would not (Step 4
supplies the changing signal).

Pass down at `FindingsTab.tsx:195-196`: `targetRunId`, `targetFindingId`,
`targetNonce={target?.n ?? 0}`.

Add optional `onFindingNotFound?: (id: string) => void`, called when
`targetFindingId` is non-null and no run contains it, so `page.tsx` can clear the
stale param. **Do not render an error** — the reviewer is on the findings list,
a reasonable place to be.

Update the comment at `FindingsTab.tsx:76-78`: it describes only the Timeline
path; there are now two entry points.

### Step 4 — `page.tsx`: the `?finding=` param

**File:** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.

Beside `const traceRunId = search.get("trace")` (`page.tsx:61`), read
`search.get("finding")`.

**One helper writing both keys in a single pass** — this is the single most
likely bug in this part: two sequential `setParam` calls **race**, bo `setParam`
(`page.tsx:62-67`) builds its `URLSearchParams` from the `search` captured in the
current render, so the second overwrites the first.

```ts
/** Jump to a finding's card in the Findings tab. Sets ?tab and ?finding in
 *  ONE replace — two setParam calls would race on the captured `search`. */
const goToFinding = React.useCallback((findingId: string) => {
  const sp = new URLSearchParams(search.toString());
  sp.set("tab", "findings");
  sp.set("finding", findingId);
  router.replace(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
  setFindingNonce((n) => n + 1);
}, [search, router, repoId, number]);
```

Hold `const [findingNonce, setFindingNonce] = React.useState(0)` — bo clicking
the same badge twice produces an identical URL, hence no param change and no
re-render, while the reviewer who scrolled away expects to be brought back. It is
deliberately **not** in the URL: a nonce is not part of what a shared link
carries.

Pass into `<FindingsTab>` (`page.tsx:138-161`): `targetFindingId`,
`targetFindingNonce={findingNonce}`, `onFindingNotFound={() => setParam("finding",
null)}`. Pass `onGoToFinding={goToFinding}` into `<DiffTab>` (`page.tsx:163-170`).

**Do not clear `?finding=` on success** — on success the URL describes what the
reviewer is looking at, is shareable, and survives reload, the same property
`?trace=` has. Comment it so the next reader does not "tidy" it away.

### Step 5 — Make the badge navigate

**Files:** `DiffTab.tsx`, `SmartDiffSection.tsx`, `SmartDiffSection/styles.ts`,
`messages/en/prReview.json`.

`DiffTab`: add `onGoToFinding?: (findingId: string) => void` and forward it to
`<SmartDiffSection>`; it does nothing else with it.

`SmartDiffSection`: same optional prop. At the mark badge's render site (part B),
wrap the badge in a button **when the prop is supplied**:
```tsx
<button
  type="button"
  onClick={() => onGoToFinding?.(mark.finding_id)}
  aria-label={t("smartDiff.goToFinding", { severity: t(`smartDiff.severityLabel.${mark.severity}`) })}
  style={s.markButton}
>
  <Badge …>{t(`smartDiff.severityLabel.${mark.severity}`)}</Badge>
</button>
```
When it is not supplied, render the bare `<Badge>` as part B does — so the
component stays renderable without a navigation host and part B's tests keep
passing.

`styles.ts`: `markButton` is a button reset — `{ background: "none",
borderStyle: "none", padding: 0, cursor: "pointer", display: "inline-flex",
font: "inherit", color: "inherit" }`. Longhand border, no new colour.

`messages`: add `smartDiff.goToFinding` (an aria-label, e.g. "Go to this
{severity} finding").

### Step 6 — Tests

**Files:** `SmartDiffSection.test.tsx` (extend), `FindingsPanel.test.tsx`
(extend), plus a `page`-level test if one exists for this route.

**Stub `Element.prototype.scrollIntoView` with `vi.fn()`** in any file touching
this path — jsdom does not implement it.

- `SmartDiffSection`: clicking a mark badge calls `onGoToFinding` with **that
  mark's `finding_id`**; with no `onGoToFinding` supplied the badge renders as
  plain text and no button role appears.
- `FindingsPanel`: a `targetFindingId` present in `findings` scrolls to the node
  carrying that `data-finding-id`; a `targetFindingId` hidden by `hideLow` turns
  the filter off and then focuses it; an unknown id is a no-op that does not
  throw; the same id with a bumped `targetNonce` scrolls **again**.
- `ReviewRunAccordion`: an accordion whose `review.findings` contains the target
  opens even when `defaultOpen` is false and `review.run_id` is `null`.
- **No popup, no modal, no new browser tab, no `github.com`** — assert no
  `window.open` call and no anchor to an external host on the navigation path.

### Step 7 — Manual check

Run the app. From Files changed → Smart order, click a `blocker` badge. Confirm:
the tab switches to Findings; the right accordion opens (including for an older
run); the right card is expanded, highlighted, and scrolled into view; the URL
reads `?tab=findings&finding=<uuid>`; a reload restores the same view; clicking
the same badge twice re-scrolls; a low-confidence target un-hides itself; **no
popup and no github.com**.

### Step 8 — Documentation sweep

**Files:** `server/src/modules/smart-diff/CLAUDE.md` (finalise),
`server/src/modules/pulls/CLAUDE.md`, all three specs (`Status: done`).

Add a bullet to `pulls/CLAUDE.md`: reviewer-ordered grouping lives in
`../smart-diff/CLAUDE.md`; `pulls` owns the raw file list, `smart-diff` owns its
ordering, neither writes the other's rows.

**Re-read every doc comment and `CLAUDE.md` bullet these three parts touched for
statements the work made stale.** In particular `modules/index.ts`'s header lists
"intent/smart-diff" among modules "each course lesson adds" — spec 0004 already
made the intent half wrong and this makes the rest wrong. Grep the whole diff for
"later wave", "not yet", "will eventually", "TODO once", "out of scope", "part C",
and for "smart diff" in comments written before this change. The root
`INSIGHTS.md` records this precise failure mode.

Run the `engineering-insights` skill. Candidates: that `reviews.run_id` is
nullable and finding-membership is the robust accordion condition; that two
sequential `setParam` calls race on the captured `search`; that jsdom lacks
`scrollIntoView`.

---

## Verification

| When | Command | From | Pass criterion |
|---|---|---|---|
| step 0 | `pnpm typecheck && pnpm lint && pnpm test` | `client/` | record the numbers |
| after 1–5 | `pnpm typecheck && pnpm lint` | `client/` | exit 0, no new warnings |
| after 6 | `pnpm test` | `client/` | all pass; **`FindingsPanel.test.tsx` unedited** |
| after 6 | `pnpm build` | `client/` | exit 0 |
| after 7 | manual, the nine checks in Step 7 | browser | all nine — in particular no popup and no github.com |
| after 8 | `pnpm arch:check` | `server/` | summary line still 0 errors, ≤ 6 warnings |
| after 8 | `pnpm typecheck` | `server/` | still exactly the 2 pre-existing errors |

---

## Acceptance

- [ ] Clicking a mark badge navigates to `?tab=findings&finding=<finding_id>` via
      `router.replace`, in **one** `URLSearchParams` pass.
- [ ] **No popup, no modal, no drawer, no `window.open`, no github.com link, and
      no scroll-to-top-of-file** on this path.
- [ ] The target card is expanded, highlighted (`focused`), and scrolled into
      view; `FindingCard` itself is unmodified apart from the commented
      `scrollMarginTop` decision.
- [ ] The accordion opens by **finding membership**, so an older run whose
      `run_id` is null still opens.
- [ ] A `hideLow`-hidden target un-hides itself rather than being swallowed.
- [ ] Clicking the same badge twice re-scrolls (the nonce).
- [ ] An unknown `?finding=` id is a silent no-op and the param is cleared.
- [ ] `?finding=` survives a reload and is shareable; it is **not** cleared on
      success.
- [ ] The Timeline → Review-runs path still works unchanged.
- [ ] All new props are optional; no existing test needed editing to keep passing.
- [ ] Every string from `messages/`; the badge has an `aria-label`.
- [ ] No comment in the touched files still describes Smart Diff as unbuilt; all
      three specs read `Status: done`.

---

## Out of scope for part C

Navigating the other way (a finding card → its line in Files changed) · inline
commenting in the reviewer-ordered list · persisting the toggle · deep-linking to
a *line* rather than a finding · e2e flow coverage — the manual check in Step 7
is what this part delivers.

## Open questions

- Should `?finding=` be cleared after a successful focus? **Assumed no** — the
  URL then describes what the reviewer is looking at, survives reload, and is
  shareable, exactly as `?trace=` behaves.
- Should a repeat click also *re-expand* a card the reviewer manually collapsed?
  **Assumed no** — `defaultExpanded` is an initial value, and fighting the user's
  own collapse is worse than a scroll to a collapsed card.
