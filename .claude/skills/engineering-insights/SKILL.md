---
name: engineering-insights
description: "Captures durable, non-obvious engineering findings into the nearest INSIGHTS.md file. Use proactively during any coding task the moment something surprising is found — behaviour that contradicted expectation, a dead end that cost real time, a deliberate trade-off, a tooling quirk — and again before reporting a task complete. Covers which INSIGHTS.md to write to, what qualifies as an insight, and the required entry format."
---

# Engineering insights

Every package already tells you to read its `INSIGHTS.md` before working. This
skill is the other half: writing to it, so the next session starts where this
one ended.

Entries are always in **English**, even when the session is in another language.
They are read by an agent working next to English code and English `CLAUDE.md`
files.

## Where the entry goes

Route by the path of the file you **edited**, not by where the conversation
started:

| Edited path | Target |
|---|---|
| `server/**` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| `scripts/`, `docs/`, `.github/`, root config | `INSIGHTS.md` (repo root) |

- A task touching two packages produces **two separate entries**, one per file.
  Never cross-post the same text.
- A fact about how packages interact, owned by none of them, goes to the root file.
- Never create an `INSIGHTS.md` beyond these five — no per-module files.

## When to capture

Two moments:

1. **As you go** — the moment something surprises you. Do not wait; the detail
   that makes an entry useful is the one you forget first.
2. **Before reporting a task complete** — scan back over the task for anything
   worth keeping.

Trivial work records nothing: typos, renames, formatting, a change that behaved
exactly as expected. **Zero entries is a normal outcome.** Writing an entry
because the skill ran is worse than writing none.

## What qualifies

The test: **if it would be obvious to anyone reading the code, do not write it.**

Worth recording: behaviour that contradicted a reasonable expectation; a dead
end and why it was a dead end; a trade-off taken on purpose, with the reason; a
dependency or tool quirk that will bite again.

Not worth recording: a restatement of what the code plainly does; change history
(that is git); planned work (that is `specs/`); general programming advice.

Vague versus useful, in this repo's terms:

- Bad — `Be careful with the DI container.`
- Good — `Resolving an adapter by direct import instead of through
  container.ts silently defeats mock injection: the real adapter is used and
  the *.it.test.ts run hits Postgres. Always go through the container.`

- Bad — `Migrations can be confusing.`
- Good — `Migrations do not run on boot, so a fresh clone serves 500s from
  every table-backed route until pnpm db:migrate is run manually.`

The good ones are actionable cold: an agent reads it and knows what to do,
without chasing context.

## Entry format

Match the `## Format` block already in the target file:

```markdown
## <The fact, stated as a claim>

**Found:** YYYY-MM-DD · **Applies to:** src/path

What happens, then why (the mechanism), then the rule that follows.
```

- The title states the fact, not the topic. It may carry a category prefix when
  that sharpens it: `Pattern:`, `Trap:`, `Decision:`, `Tooling:`.
- `Applies to:` — `src/path` inside `server`, `client`, `reviewer-core`;
  plain `path` in `e2e` and at the root.
- `Found:` — today's real date, never invented.

## How to write it

1. Read the target file first.
2. Append the new section **after** the trailing `---`. On the first entry,
   remove the `_No insights recorded yet._` line.
3. If the fact is already there, sharpen the existing section instead of adding
   a second one.
4. If a new finding disproves an existing entry, **replace it**. A wrong insight
   is worse than a missing one — do not leave both standing.

Never edit the `## Format` or `## Rules` sections of these files.

Writing an entry is a routine part of the task, so it needs no permission — but
say what was recorded, and where, when reporting the work.
