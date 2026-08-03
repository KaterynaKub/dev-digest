# Report format

Two outputs: the **review report** shown in the conversation, and the **PR-body
block** the author pastes into the pull request.

The report is written in the conversation language. File paths, rule names,
skill names, commands and the PR-body block stay verbatim in English.

## Review report

### Header — always

```
Base: origin/main (a1b2c3d) · 14 files · +420 −87
Domains: UI (6), Backend (5), DB (2), E2E (1)
Skills: ui-frontend-architecture, react-best-practices, onion-architecture,
        drizzle-orm-patterns, security
Checks: typecheck ✅ · arch:check — (not configured)
```

State every deviation from a normal run explicitly:
- comparison base is stale (fetch failed)
- run was batched (over 60 files) and how many batches
- a check was skipped, and why

### BLOCK

```markdown
## PR Self-Review — ❌ BLOCK

<header>

### 🔴 CRITICAL — 2 · these block the PR

1. `server/src/modules/reviews/review.service.ts:42` — [onion-architecture]
   **What:** the domain service imports a Fastify type from the platform layer.
   **Why:** dependencies point inward; the domain must not know the transport.
   **Fix:** declare the shape in `modules/reviews/ports.ts` and inject it.

2. `server/src/db/schema.ts:88` — [guard: schema-without-migration]
   **What:** `reviews.cost_cents` added with no migration file.
   **Why:** migrations do not run on boot — every environment breaks on deploy.
   **Fix:** `cd server && pnpm db:generate`, then commit the migration.

### 🟠 HIGH — 3
...

### 🟡 MEDIUM — 5
<details><summary>Show</summary>
...
</details>

**Verdict: BLOCK.** Fix the 2 CRITICAL findings and re-run `/pr-self-review`.
`/pr-self-review --fix` can handle #1 mechanically; #2 needs the migration
generated.
```

Each CRITICAL carries **what / why / fix**. A blocker without a fix is a
doorman, not a review.

### WARN / PASS

Same shape, with `⚠️ WARN` or `✅ PASS`. On PASS, say what was checked — a bare
"looks good" is indistinguishable from a review that never ran:

```markdown
## PR Self-Review — ✅ PASS

<header>

No CRITICAL or HIGH findings.

### 🟡 MEDIUM — 2
<details><summary>Show</summary>
...
</details>

**Verdict: PASS.** Safe to open the PR.
```

## PR-body block — on PASS and WARN only

Emit this straight after the report, in a fenced block, ready to paste. Always
English — it goes into the repository.

```markdown
## Self-review
Pre-PR self-review passed (`/pr-self-review`).
Checked: UI (6 files), Backend (5), DB (2) · typecheck ✅
Skills applied: ui-frontend-architecture, react-best-practices,
onion-architecture, drizzle-orm-patterns, security

Accepted HIGH findings (deliberate):
- `client/src/components/PullList.tsx:88` — inline sort kept; the list is
  capped at 50 items, so the cost is bounded.
```

Drop the "Accepted HIGH findings" section entirely on PASS. On WARN it is
required — an unexplained HIGH in a PR body is worse than none, because the
reviewer cannot tell whether it was considered or missed.

Never emit this block on BLOCK.

## Finding style

- One finding, one location group. Five files with the same issue → one entry.
- Point at the line the change touched, not the general area.
- The fix is an instruction, not a suggestion: "move the type into
  `ports.ts`", not "consider revisiting the boundary".
- No praise sections. A clean result is `PASS`, which already says it.
