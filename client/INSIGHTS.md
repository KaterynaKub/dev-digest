# client — insights

Durable, non-obvious facts discovered while working in this package. Append a
new section as you find them; delete one when it stops being true.

## Format

```markdown
## <The fact, stated as a claim>

**Found:** YYYY-MM-DD · **Applies to:** src/path

What happens, then why (the mechanism), then the rule that follows.
```

## Rules

- One fact per section. Title states the fact, not the topic.
- Only what the code does not already say plainly — no restating logic.
- Not change history (that is git) and not planned work (that is `specs/`).
- A wrong insight is worse than a missing one: delete on invalidation.

---

## Trap: `vendor/shared` is duplicated in client and server, with no sync script

**Found:** 2026-08-01 · **Applies to:** src/vendor/shared

`@devdigest/shared` is a tsconfig path alias, not a package: `client/src/vendor/
shared/` and `server/src/vendor/shared/` are two independent copies, and nothing
keeps them in step (they have already drifted — the client copy lacks
`sessionId` and `commitFiles`). `reviewer-core` aliases the SERVER copy. Adding
a contract field therefore means editing both files by hand; touching only one
leaves the client typed against a shape the API does not return. Add the field
pointwise rather than copying a whole file over the other, or you will revert
the drift that is there on purpose.

## Tooling: webpack needs `extensionAlias` to read `vendor/shared`'s `.js` specifiers

**Found:** 2026-08-02 · **Applies to:** next.config.mjs

The vendored contracts import each other as `'./contracts/findings.js'` while
the files on disk are `.ts`. That is mandatory on the server side — it is
`"type": "module"` and ships as plain `node dist/server.js`, where ESM demands
the extension — and `tsc` accepts it here because this package sets
`moduleResolution: "Bundler"`. Webpack does not, so it reads the specifier
literally and fails with "Can't resolve './contracts/findings.js'".

The failure hid for a long time because every client import from
`@devdigest/shared` was `import type`, which is erased before webpack runs. The
first import of a VALUE (a Zod schema, a constant) broke `next build` while
`tsc --noEmit` stayed green. `next.config.mjs` now maps `.js` → `.ts/.tsx/.js`
via `config.resolve.extensionAlias`; do not "fix" a future occurrence by
stripping the extensions from the contracts, which would break the server's
runtime.

Separately, prefer inlining a lone constant over importing it: the contracts are
Zod modules, so one number costs ~14 kB of bundle, and via the barrel — which
`export *`s ten contract files and cannot be tree-shaken — ~17 kB.

## Trap: a `nullish()` contract field is invisible to the compiler at the boundary

**Found:** 2026-08-01 · **Applies to:** src/vendor/shared/contracts

GET handlers on the server declare only `params` — no response schema — so Zod
never serialises replies, and the client's `apiFetch` casts JSON with `as T`
without parsing. A field declared `nullish()` is optional in both directions:
forget it in the repository mapper and neither TS nor a runtime check will
complain, it just never appears. `RunSummary` uses `nullable()` for exactly this
reason (the mapper builds it row-by-row, so TS can enforce it), while `RunStats`
must stay `nullish()` because it is parsed back out of older `run_traces` jsonb
documents that predate the fields. Pick the modifier from where the object is
built, not from taste.

## Trap: `RATIONALE_PREVIEW_CHARS` has a third copy outside `vendor/shared`

**Found:** 2026-08-02 · **Applies to:** src/lib/findings-view.ts

Beyond the client/server `vendor/shared` duplication, the findings-preview
budget has a *third* copy: `src/lib/findings-view.ts` inlines the number
deliberately, because importing it would pull Zod into the browser bundle for a
value the browser never validates with. It is load-bearing, not a stale leftover:
the two surfaces truncate in different places. The PR list receives rationales
already cut by the server, while the PR detail timeline receives full findings
and cuts them client-side through `clampRationale`.

Changing the budget in the two contract files alone therefore leaves the timeline
on the old value, and the same finding previews at two different lengths
depending on the surface — with no type error anywhere, since the copies are
independent literals. Grep the constant by name before changing it and expect
three hits.

## Decision: the hover panel's rationale budget is derived from the line clamp, not chosen

**Found:** 2026-08-02 · **Applies to:** src/vendor/ui/kit/FindingsSeverityRow

`RATIONALE_PREVIEW_CHARS` (150) and `s.itemRationale`'s `WebkitLineClamp` (2) are
one decision split across two files, and neither states the link. The panel is
`PANEL_WIDTH` 380px less 24px of item padding ≈ 356px, which at `fontSize: 12`
renders roughly 65 characters per line, so two lines hold ~130. The budget sits
above that on purpose: the visible ellipsis should come from the CSS clamp, which
lands on the true visual edge, rather than from the server's word-boundary cut,
which would appear mid-panel at an arbitrary spot.

Change the clamp and the character budget together, or the panel either wastes
payload on text that is clipped anyway, or shows a `…` short of the edge.

## Pattern: in the panel's flex rows, only the elastic cell may shrink

**Found:** 2026-08-02 · **Applies to:** src/vendor/ui/primitives

`ConfidenceNum` and `CategoryTag` are flex children sitting beside a long file
path or title. Without `flexShrink: 0` they are compressed by that sibling, and
because they are `inline-flex` with a `gap` the compression breaks them *inside*
the label — `100%` and `conf` land on separate lines, and the status dot flattens
into an oval. The fix belongs on those primitives (they are atomic labels
everywhere they appear), while the ellipsis belongs on a wrapper the panel owns:
`MonoLink` is shared with `FindingCard`, where the path is meant to wrap rather
than truncate, so `s.itemMetaPath` wraps it instead of the primitive changing.

Whenever a fixed-size label shares a flex row with elastic text, mark the label
`flexShrink: 0` + `whiteSpace: nowrap` and give the elastic cell `minWidth: 0` —
without the latter a flex child refuses to shrink below its content width and
the ellipsis never appears.

## Trap: no top-level `*ListView` component has ever been rendered in a test

**Found:** 2026-08-03 · **Applies to:** src/app/**/_components/*ListView

Every existing `*ListView` (`AgentsListView`, and now `SkillsListView`) wraps its
content in `<AppShell>`, which pulls in `useGlobalShortcuts`/`useShellCommands`/
`useShellContext` — all of which call `useRouter()`/`usePathname()` from
`next/navigation`. Rendering the real `AppShell` under vitest+jsdom throws
"invariant expected app router to be mounted" the moment any descendant also
calls `useRouter()` (e.g. a preview panel with an Edit button). No test in this
repo has ever exercised the real `AppShell`; `AgentsListView` itself has no test
file at all. The working pattern (see `SkillsListView.test.tsx`) is to
`vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }) => <div>{children}</div> }))`
and separately `vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))`
for any descendant that navigates — mocking only one of the two still throws.

## Decision: `SkillDraft`'s edited-in-preview fields reuse the editor's own labels, not new copy

**Found:** 2026-08-03 · **Applies to:** src/app/skills

`AddSkillDrawer` renders the same name/description/type/body fields as
`SkillDetail`'s Config tab and deliberately pulls their labels from `skills.editor.*`
(`editor.name`, `editor.descriptionHint`, etc.) rather than adding parallel
`file.*` label keys. `skills.json`'s pre-existing `file.*` block only supplies
placeholders/hints for the *paste-a-file* flow's own copy (`file.namePlaceholder`,
`file.bodyPlaceholder`) — treat `editor.*` as the single source of field labels
for anywhere a Skill's fields are edited, and `file.*`/`preview.*` as flavor text
layered on top per-surface.

## Trap: `getByDisplayValue` silently never matches a multi-line textarea value

**Found:** 2026-08-03 · **Applies to:** src/app/skills

Every skill body is multi-line, and `screen.getByDisplayValue("# Body\nSome rule
text.")` fails with "Unable to find an element with the display value" even
though the textarea holds exactly that string. RTL normalises whitespace in the
matcher (collapsing `\n` to a space) but compares against the raw `value`, so an
exact multi-line string can never match. The failure reads like the component
did not render the value at all, which sends you debugging the wrong thing.
Match such fields with a regex anchored on the first line —
`getByDisplayValue(/^# Body/)` — rather than the full string.

## Trap: clicking a card's text does not trigger the card's own `onClick` here

**Found:** 2026-08-03 · **Applies to:** src/app/skills/_components/SkillsListView

`SkillCard` puts `onClick` on the outer card div, and the name lives in a nested
`<span>` several levels down. `fireEvent.click(screen.getByText(name))` dispatches
on the span; the handler is only reached via React's synthetic-event delegation,
which is unreliable across the nested-`div` structure here — the test fails as if
the selection never happened. Worse, once a skill IS selected its name appears
twice (list card + detail header), so `getByText` starts throwing "multiple
elements" instead. Select by walking up to the clickable element and take the
first match:
`screen.getAllByText(name)[0].closest("div[style*='cursor: pointer']")`.

## Decision: tab state in `SkillDetail` is local, unlike `AgentEditor`'s `?tab=`

**Found:** 2026-08-03 · **Applies to:** src/app/skills/_components/SkillsListView/_components/SkillDetail

`AgentEditor` keeps its tab in the URL (`?tab=`) and `SkillDetail` deliberately
does not, which looks inconsistent until you note where each one sits.
`AgentEditor` IS the page at `/agents/[id]`, so a URL-encoded tab is
shareable and Back behaves as expected. `SkillDetail` is a pane inside the
`/skills` list page: putting its tab in the URL would make the browser Back
button undo a tab switch rather than leave the page, and it would push a history
entry per tab click. Copy the `?tab=` idiom only for a tab bar that owns its
whole route.
