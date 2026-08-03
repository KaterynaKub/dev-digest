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

The same bypass works for any tool in the package, but it must target the real
entry point, not the shim: `node node_modules/.bin/depcruise` dies with
`SyntaxError: missing ) after argument list`, because on Windows `.bin/` holds
`sh` wrappers rather than JS. Resolve the path from the package's `bin` field
instead — `node node_modules/dependency-cruiser/bin/dependency-cruise.mjs`,
`node node_modules/typescript/bin/tsc`.

---

## Trap: `pnpm arch:check` exits 0 while reporting violations

**Found:** 2026-08-03 · **Applies to:** server/.dependency-cruiser.cjs, reviewer-core/.dependency-cruiser.cjs

dependency-cruiser is configured with `warn`-severity rules, so a run reporting
`x 20 dependency violations (0 errors, 20 warnings)` still exits 0. Any gate,
script, or CI step that judges `arch:check` by its exit code alone passes while
every violation goes unseen — including layer breaches the rules exist to catch
(`service-no-container`, `routes-no-persistence`, `no-circular`).

Parse the summary line and the `warn` entries; treat the exit code as meaningful
only for `error`-severity rules. Raise a rule to `error` when it should actually
break the build.

---

## Trap: piping a check into `tail` or `head` silently discards its exit code

**Found:** 2026-08-03 · **Applies to:** scripts/, .claude/hooks/

`pnpm typecheck 2>&1 | tail -15` always reports success: in a pipeline `$?` is
the exit status of the last command, and `tail` succeeds even when the check it
is summarising failed. This is easy to miss precisely where it matters most —
trimming a noisy tool's output while deciding whether the tool passed.

Redirect to a file, capture the status, then read the file:
`pnpm typecheck > /tmp/tc.log 2>&1; echo "exit=$?"`. Alternatively set
`set -o pipefail`, which is not on by default in the `sh` used by git hooks.

---

## Trap: a multi-wave feature built by parallel subagents leaves "later wave" comments stale the moment the later wave lands

**Found:** 2026-08-03 · **Applies to:** any multi-package feature split across sequential/parallel agent runs

Wave 1 of the Skills feature (`server/src/modules/skills/`) shipped doc
comments like "wrapping is NOT this module's job — it belongs to
`run-executor.ts` (a later wave)" — accurate when written, since the
run-executor wiring genuinely hadn't landed yet. Wave 2 then implemented
exactly that wiring in the same overall task, but nothing re-visited Wave 1's
comments to drop the now-false "later wave" qualifier. Nobody caught it until
a `pr-self-review` pass read `modules/skills/CLAUDE.md` and
`repository.ts` side-by-side with the (now-existing) `run-executor.ts` code.

The failure mode is generic, not specific to this feature: any comment or
`CLAUDE.md` bullet that describes a dependency as "not yet built" is a ticking
staleness bug the moment a later wave/agent/session builds it, and nothing
forces a re-read of earlier waves' prose once the code changes underneath it.
When closing out the last wave of a multi-wave plan, grep the whole diff (not
just the new wave's files) for phrases like "later wave", "not yet", "will
eventually", "TODO once" — anything time-relative — and update or remove them
before treating the feature as done.
