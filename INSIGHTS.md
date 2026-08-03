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

## Tooling: an unresolved `pnpm-workspace.yaml` makes every `pnpm <script>` fail before the script runs

**Found:** 2026-08-02 · **Applies to:** client/pnpm-workspace.yaml, server/pnpm-workspace.yaml

`pnpm test` in `client/` and `server/` can abort with `ERR_PNPM_IGNORED_BUILDS`
and `Command failed with exit code 1: ... pnpm install` without ever reaching
vitest. The cause is not a broken test setup: pnpm runs a deps-status check
before any script, and both packages have an untracked `pnpm-workspace.yaml`
whose `allowBuilds:` entries are still literal placeholders —
`esbuild: set this to true or false`, and likewise `sharp` (client) or
`cpu-features`/`protobufjs`/`ssh2` (server). Until each is a real `true`/`false`
the check fails, so the failure looks like a test failure but no test ran.

Read the traceback before debugging tests: frames inside `pnpm.mjs` mean the
package manager stopped, not the suite. To run tests without touching the file,
skip the wrapper — `node node_modules/vitest/vitest.mjs run <filter>` from the
package directory. Note `--dir` is overridden by the config's `include` and
matches nothing; pass a bare substring as a positional filter instead.
