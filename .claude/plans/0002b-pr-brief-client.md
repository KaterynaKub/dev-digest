# 0002b — PR Why + Risk Brief: client card, navigation, states

**Status:** draft
**Date:** 2026-08-25
**Mode:** single-agent
**Touches:** `client/src/lib/hooks/reviews.ts` · `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/` (new) · `.../OverviewTab/OverviewTab.tsx` · `.../pulls/[number]/page.tsx` · `client/messages/en/brief.json` · `e2e/specs/`

## Prerequisites

`0002a` must have landed. One command proves it:

```
cd server && grep -q "review_focus" src/vendor/shared/contracts/brief.ts && echo READY
```

If that prints nothing, the contract still carries the dormant four-block
`PrBrief` and every type in this plan is unavailable.

## Requirements

Source: `docs/specs/SPEC-02-pr-why-risk-brief.md` (**Status: approved**).
This part implements the display and navigation half: AC-8, AC-9, AC-10, AC-19,
AC-24, AC-32, AC-34, AC-42…AC-53, NFR-17, NFR-18, NFR-19.
Server generation, persistence, and validation are `0002a`.

## Requirements review

- **`goToLocation` cannot serve the brief unchanged — this is the one real code
  conflict in the feature** — `[proceeding as asked]`
  `page.tsx:105-146` decides both branches from the blast index's sha: it computes
  `staleForDiff = indexedSha != null && indexedSha !== pr.head_sha` and forces
  **every** stale target out to GitHub even for a file the PR changed, then pins
  the blob URL to `indexedSha ?? pr.head_sha`. AC-45 requires the brief's
  coordinates to pin to **head**, always. Passing `null` as `indexedSha` happens to
  produce the right URL, but it does so by coincidence of the fallback and leaves
  the "stale → always GitHub" branch silently applying blast's rule to
  head-anchored data. Step 3 adds an explicit third argument instead.
- **The `brief` message namespace exists but describes the dormant contract** —
  `[recommended]` `client/messages/en/brief.json` carries `block.intent`,
  `block.blast`, `block.risks`, `block.history`, `noHistory`, `overlap` — all keys
  for the four-block `PrBrief` this feature replaces. Replace those keys; a card
  wired to a stale namespace **renders without throwing** (spec Verification
  notes). The `why.*` subtree belongs to git-why and must not be touched.
- **AC-9/AC-10 are the trap this feature is most likely to fail** —
  `[proceeding as asked]` `cost_usd` of `0` is a real price
  (`server/INSIGHTS.md:39`). Every check must be `!= null`, never truthiness; a
  `cost_usd ? … : "unknown"` renders a free brief as unknown cost.
- **No mockup image exists** — `[proceeding as asked]` The spec records that the
  design arrived as two written descriptions. Visual detail beyond AC-49…AC-53 is
  the implementer's judgement, matched to the neighbouring cards.

## Problem

`OverviewTab.tsx:35-42` renders `IntentCard` and `BlastRadiusCard` in a
two-column grid and nothing above them. A reviewer gets the author's stated
scope and a caller map and no synthesis; the brief `0002a` produces has no
surface. `client/src/lib/types.ts:36` re-exports `PrBrief` to no consumer.

## Approach

One new colocated component `_components/PrBriefCard/`, shaped `PrBriefCard.tsx`
· `constants.ts` · `styles.ts` · `index.ts` · `PrBriefCard.test.tsx`, rendered by
`OverviewTab` **above** the existing grid (AC-49, design finding D-10 — the list
labelled "read these first" must not sit below the fold). The existing two cards
are untouched.

Data through two new hooks in `src/lib/hooks/reviews.ts`, next to `useIntent` /
`useDeriveIntent`, which already model exactly this read + money-spending-mutation
pair. No `fetch` from the component.

Navigation reuses the page's `goToLocation` with one added parameter rather than
a second callback — rejected a parallel `goToBriefLocation` because two callbacks
computing `changedPaths` would drift.

## Affected packages and modules

| Package | Path | What changes |
|---|---|---|
| client | `src/lib/hooks/reviews.ts` | `useBrief`, `useGenerateBrief` |
| client | `.../_components/PrBriefCard/` (new) | the card, 5 files |
| client | `.../_components/OverviewTab/OverviewTab.tsx` | render the card above the grid; forward props |
| client | `.../pulls/[number]/page.tsx` | `goToLocation` gains a pin argument |
| client | `messages/en/brief.json` | replace the dormant keys; keep `why.*` |
| e2e | `specs/*.flow.json` (new) | generate → click a focus entry |

No contract edit — `0002a` did both copies. If this plan finds itself editing
`vendor/shared/`, that is a signal `0002a` was incomplete, and the edit must be
made in **both** copies and verified by `diff`.

## Architectural constraints

- All HTTP through `src/lib/api.ts`, reached via `src/lib/hooks/*`. Never `fetch`
  from a component (`client/CLAUDE.md`).
- Types come from `@devdigest/shared` — never redeclare `PrBrief`,
  `ReviewFocusEntry`, or `Risk` locally.
- Every user-facing string lives in `messages/`, never inline in JSX.
- **Every async action shows a loader.** The generate `Button` takes
  `loading={isPending}` and a `…` label from `messages/`; the card's loading area
  gets a `Skeleton` **with** a named `role="status"` line saying what is happening
  — that status line is also what satisfies NFR-18.
  `CreateSkillFromConventionsModal` is the reference.
- Feature logic stays colocated in `_components/<Name>/`. There is **no
  `src/features/`** in this repo — where `ui-frontend-architecture` describes one,
  `client/CLAUDE.md` wins.
- Render brief text as plain React children only — no `dangerouslySetInnerHTML`
  anywhere in the card (AC-57).
- Risk level and every degradation state carry a **text label**, not colour alone
  (AC-50, NFR-19). Every entry and the regenerate control are keyboard-operable —
  real `<button>`s, not clickable `<div>`s (NFR-17).

The frontend has no `arch:check`. These constraints are the gate.

## Implementation steps

### Step 1 — Hooks
- **Files:** `client/src/lib/hooks/reviews.ts` (edit)
- **Do:** `useBrief(prId)` — `useQuery`, key `["pr-brief", prId]`,
  `api.get<{ brief: PrBriefRecord | null }>(\`/pulls/${prId}/brief\`)`,
  `enabled: !!prId`. `useGenerateBrief(prId)` — `useMutation` POSTing
  `/pulls/${prId}/brief/generate`, invalidating `["pr-brief", prId]` on success.
  Model both on `useIntent` / `useDeriveIntent` (`reviews.ts:146-161`), whose
  cost profile is identical.
- **Done when:** `pnpm typecheck` from `client/` passes.

### Step 2 — Messages
- **Files:** `client/messages/en/brief.json` (edit)
- **Do:** Remove `block.*`, `noHistory`, `overlap`, `unavailable`,
  `unavailableHint` — all keys of the replaced contract. **Leave `why.*`
  untouched** (a different feature). Add keys for: the card title and a
  model-generated label (NFR-13); `riskLevel.{high,medium,low}` as text (AC-50);
  a risk-level label that reads as a brief's risk and not a review verdict or PR
  score (AC-52); section headings for risks and review focus; the never-generated
  empty state including a statement that generating **spends money** (AC-51); the
  generating label and its `…` button variant (AC-32); the failure message with
  its reason (AC-40); "the model was given file metadata only — no diff content"
  (AC-42); missing-input notices (AC-41); the stale-index notice, worded as
  "impact information describes an older commit" (AC-37); the rejected-entry
  notice (AC-24); the selected-documents label (AC-19); cost, token counts, and a
  distinct **unknown-cost** string (AC-8, AC-10); head sha and generated-at
  (AC-34); the regenerate control (AC-31).
- **Done when:** every string the card renders resolves through
  `useTranslations("brief")` and no key it uses is absent.

### Step 3 — Head-pinned navigation
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit)
- **Do:** Widen `goToLocation` to `(file, line, sha, pin: "index" | "head")`.
  With `pin === "head"`: skip the `staleForDiff` check entirely — a brief
  coordinate is never stale, it comes from the diff — and build the blob URL from
  `pr.head_sha` **only**, never `sha ?? pr.head_sha` (AC-45). With
  `pin === "index"`: current behaviour verbatim, so blast is unchanged. Keep the
  existing early return when `activeRepo?.full_name` or `pr` is missing, which is
  already AC-47. Keep the nonce bump — re-clicking the same entry must navigate
  again (AC-48; `client/INSIGHTS.md:268`, and note the `target?.line, target?.nonce`
  dependency-array trap at `INSIGHTS.md:330`). Update `BlastRadiusCard`'s existing
  call site to pass `"index"`.
- **Done when:** `BlastRadiusCard`'s behaviour is byte-for-byte unchanged and
  `pnpm typecheck` passes.

### Step 4 — `PrBriefCard`
- **Files:** `.../_components/PrBriefCard/{PrBriefCard.tsx,constants.ts,styles.ts,index.ts}` (new)
- **Do:** Props `{ prId, repoId, headSha, onGoToLocation }`. States, each with a
  distinct render:
  - **never generated** — empty state, generate button, explicit spend warning
    (AC-51).
  - **generating** — `Skeleton` plus a `role="status"` line; the button shows
    `loading` and its `…` label (AC-32, NFR-18).
  - **failed** — the reason, and the previously stored brief still rendered below
    it if one exists (AC-40, AC-59).
  - **present** — `what`, `why`, the risk level as a **text** label distinguished
    from a verdict/score (AC-50, AC-52); risks each showing severity, title,
    explanation, and surviving file refs (AC-53); the review-focus list in
    **server order, unsorted** (AC-6); the selected document paths (AC-19); a
    rejected-entries notice with its reasons when any were dropped (AC-24); a
    missing-inputs notice (AC-41); the stale-index notice when `index_stale`
    (AC-37); the "metadata only, no diff content" line (AC-42); head sha and
    generated-at (AC-34); the model-generated label (NFR-13); the regenerate
    control (AC-31).
  - **all references rejected** — `what`, `why`, and risk level still shown, with
    an explicit statement that no reference survived (AC-26).
  Cost line: render `cost_usd` when `!= null` — **including `0`** — and the
  unknown string only when `null` (AC-9, AC-10), alongside `tokens_in` and
  `tokens_out` (AC-8). Every focus entry and risk file ref is a real `<button>`
  calling `onGoToLocation(file, line, null, "head")`; render it inert, not
  clickable, when the destination is unresolvable (AC-47). An entry whose `line`
  is `null` renders without a line number (AC-25).
- **Done when:** each state renders from a fixture without a console error.

### Step 5 — Mount
- **Files:** `.../_components/OverviewTab/OverviewTab.tsx`, `page.tsx` (edits)
- **Do:** Render `<PrBriefCard>` above `<div style={s.grid}>` — full width, above
  both existing cards (AC-49). Thread `headSha` and the widened `onGoToLocation`
  through `OverviewTab`'s props; keep them optional so the tab stays renderable
  without a host, matching the existing `onGoToLocation` prop doc.
- **Done when:** the Overview tab orders brief → intent + blast grid.

### Step 6 — Tests
- **Files:** `.../PrBriefCard/PrBriefCard.test.tsx` (new), `e2e/specs/` (new)
- **Do:** Use `fireEvent` — **`@testing-library/user-event` is not installed**,
  and importing it fails at collection time with an error naming the *test file*,
  not the package (`client/INSIGHTS.md:289`). Cover: every state from Step 4
  (AC-32, AC-37, AC-40, AC-41, AC-42, AC-49…AC-53, AC-26); cost with `0` (asserting
  a price, **not** "unknown"), with `null` (asserting unknown), and both token
  counts (AC-8…AC-10); the rejected-entry notice (AC-24); document paths visible
  (AC-19); focus order preserved against a deliberately non-alphabetical fixture
  (AC-6); a `null` line rendered without a number (AC-25); clicking an in-PR entry
  (AC-43) and an out-of-PR entry (AC-44); the same entry clicked twice navigating
  twice (AC-48); an entry inert without `full_name` (AC-47).
  **AC-45 needs a fixture where `indexed_sha !== head_sha`** — with the two equal,
  a correct implementation is indistinguishable from one that reuses blast's rule.
  Assert the GitHub URL carries the **head** sha.
  E2E flow: generate a brief, click a focus entry into Files-changed, click one
  that leaves for GitHub. **Assert the diff row is actually reached** — a row is
  addressable only with its group and file card open, a boilerplate group is closed
  by default, and a focus entry usually names a line with no finding, so asserting
  only "the tab changed" passes while the reviewer lands nowhere.
- **Done when:** client tests pass at ≥ 208 and the flow runs hermetically.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| after steps 1, 3, 4, 5 | `pnpm typecheck` | `client/` | exit 0, no `error TS` |
| after step 5 | `pnpm lint` | `client/` | 0 errors, **≤ 3 warnings** (3 are pre-existing) |
| after step 6 | `pnpm test` | `client/` | ≥ 208 passing, 0 failing |
| after step 5 | `pnpm build` | `client/` | exit 0 |
| after step 6 | `pnpm typecheck` && `pnpm e2e:hermetic` | `e2e/` | exit 0 |
| after step 3 | `pnpm test` | `client/` | `BlastRadiusCard` tests unchanged and passing — proves the `goToLocation` widening did not alter blast behaviour |

Baseline to record before the first edit: `client` test count (expect 208 in 30
files) and `lint` output (expect 0 errors / 3 warnings). Never pipe a check into
`head` or `tail` — it discards the exit code.

## Acceptance
- [ ] AC-8, AC-9, AC-10, AC-19, AC-24, AC-32, AC-34, AC-42…AC-53 hold, each with
      the test named in Step 6.
- [ ] NFR-17 (keyboard), NFR-18 (status message), NFR-19 (text not colour) hold.
- [ ] NFR-1 (cache hit ≤ 300 ms p95) is **manual review only** — no harness.
- [ ] `messages/en/brief.json` has no key of the dormant four-block contract, and
      `why.*` is unchanged.
- [ ] The brief renders above both existing cards; neither `IntentCard` nor
      `BlastRadiusCard` changed.
- [ ] No `dangerouslySetInnerHTML` in the card.

## Out of scope
- Writing or amending any specification.
- Server generation, persistence, validation, document selection — `0002a`.
- Any change to `IntentCard`, `BlastRadiusCard`, `VerdictBanner`, or the
  Files-changed tab, which is a navigation destination only.
- A PR score, verdict, or findings count on the brief card (spec Non-goals, D-1).
- `Prior PRs touching these files` — no producer exists (D-3).

## Open questions

None — everything needed was determinable from the repo.
