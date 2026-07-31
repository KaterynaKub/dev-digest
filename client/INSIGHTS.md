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
