# e2e — insights

Durable, non-obvious facts discovered while working in this package. Append a
new section as you find them; delete one when it stops being true.

## Format

```markdown
## <The fact, stated as a claim>

**Found:** YYYY-MM-DD · **Applies to:** path

What happens, then why (the mechanism), then the rule that follows.
```

## Rules

- One fact per section. Title states the fact, not the topic.
- Only what the code does not already say plainly — no restating logic.
- Not change history (that is git) and not planned work (`specs/` here holds
  flow files, so proposals go to `docs/`).
- A wrong insight is worse than a missing one: delete on invalidation.

---

## Trap: a seeded `PrFile` with no `patch` makes its diff rows unreachable, even to `wait --text` on the file path

**Found:** 2026-08-26 · **Applies to:** specs/, ../server/src/db/seed.ts

`server/src/db/seed.ts`'s original four seeded `pr_files` rows all carry
`patch: null` (the column is never set). `DiffTab` → `SmartDiffSection` still
renders a file card for such a file (its header, path, +/- stats), but
`parsePatch(null)` returns `[]`, so the card's body has **zero rows** — no
`data-line`, nothing a click-driven flow can scroll to or assert against by
line content. A flow that only asserts "the tab changed to Files changed" or
"the file path text is visible" passes against this even though no actual diff
content — and no line the flow claims to have navigated to — was ever reached.

To make a "click a location, land on that exact row" flow genuinely provable,
at least one seeded `pr_files` row needs a real unified-diff `patch` string,
with its hunk header's new-side start chosen so the row of interest lands on
a predictable line number (verify by hand: `@@ -a,b +c,d @@` then count
context/add lines from `c`). `server/src/db/seed.ts` now does this for
`src/config.ts` — its patch places the (fictional) Stripe key add at exactly
new-line 12, matching the pre-existing seeded finding at the same file:line so
one fixture serves two consumers. All three of `classifyPath`'s seeded files
happen to land in the `core` group (open by default) — a file classified
`boilerplate` would additionally need its group opened before any row is
reachable at all (`SmartDiffSection`'s `GROUP_DEFAULT_OPEN`).

## Trap: a spec's own Verification notes can recommend an e2e flow this package's CLAUDE.md forbids — resolved for PR Brief by seeding a row, not by relaxing the rule

**Found:** 2026-08-25 · **Applies to:** specs/, ../docs/specs/SPEC-02-pr-why-risk-brief.md

SPEC-02's "What needs which kind of check" section lists a browser flow that
generates a PR brief, then clicks a review-focus entry into Files-changed and
one that leaves for GitHub — but generating a brief is a real, priced model
call (`POST /pulls/:id/brief/generate`), and this package's own rule is
unconditional: "Flows must stay read-only and LLM-free; never add a step that
triggers a review" (and by the same reasoning, any other model call).

The right fix was never to relax that rule: it was to remove the reason a
read-only path didn't exist. `server/src/db/seed.ts` now writes a `pr_brief`
row directly (bypassing `BriefService.generate` entirely — no model call, no
`POST`), so `10-pr-brief.flow.json` reads a persisted brief exactly like
`04-pr-findings` reads a persisted review. A spec's Verification notes asking
for a flow this package's CLAUDE.md forbids is a signal to add a seed fixture
first, not to add an exception to the read-only/LLM-free rule — the exception
was never actually needed once the fixture existed.
