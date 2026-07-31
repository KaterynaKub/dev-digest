# dev-digest — insights

Durable, non-obvious facts about the repo itself — tooling, scripts, CI, compose,
root config, and how packages interact. Anything that belongs to one package goes
in that package's own `INSIGHTS.md`. Append a new section as you find them;
delete one when it stops being true.

## Format

```markdown
## <The fact, stated as a claim>

**Found:** YYYY-MM-DD · **Applies to:** path

What happens, then why (the mechanism), then the rule that follows.
```

## Rules

- One fact per section. Title states the fact, not the topic.
- Only what the code does not already say plainly — no restating logic.
- Not change history (that is git) and not planned work (that is `specs/`).
- A wrong insight is worse than a missing one: delete on invalidation.

---

_No insights recorded yet._
