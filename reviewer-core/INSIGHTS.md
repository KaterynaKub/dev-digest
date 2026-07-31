# reviewer-core — insights

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

## Trap: cost aggregation must never be all-or-nothing across chunks

**Found:** 2026-08-01 · **Applies to:** src/review/run.ts

`reviewPullRequest` sums a cost per chunk, and map-reduce issues one LLM call
per file. An earlier version collapsed the total to `null` as soon as ANY chunk
returned no price (`cost = cost == null || res.costUsd == null ? null : …`), so
one model the price book did not know discarded the cost of every other chunk —
a review that demonstrably spent money reported nothing. The accumulator now
keeps the partial sum and records the shortfall separately via `costSource`,
which degrades `exact` → `estimated` → `partial` (worst state wins, because
incompleteness is a bigger caveat than imprecision). `costUsd` is null only when
NO chunk had a price.

## Only OpenRouter reports what it actually billed

**Found:** 2026-08-01 · **Applies to:** src/llm/openrouter.ts

OpenRouter returns a real generation cost in `usage.cost`, but only when the
request carries `usage: { include: true }` — hence that field in the request
body. The OpenAI and Anthropic adapters have no equivalent, so their cost is
always price-book multiplication and is tagged `estimated`. Consequently a
figure can only be reconciled against a provider dashboard for OpenRouter runs;
elsewhere the `~` prefix in the UI is not a bug. Note the branch tests
`costFromApi != null`, not truthiness: a free model bills exactly 0, and that is
still an *exact* figure.
