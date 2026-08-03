---
name: pr-self-review
description: "Local self-review of all pending changes before opening a pull request. Collects the diff against main, routes changed files to the relevant skills (UI skills on UI files, backend architecture skills on backend files), aggregates findings on one severity scale, and blocks PR creation when any CRITICAL is found. Use before opening a pull request, before `gh pr create`, before pushing a branch for review, or when asked to self-review local changes, check if changes are ready to merge, or verify nothing is broken before review. Trigger terms: self review, self-review, pre-PR check, before PR, gh pr create, review my changes, ready to merge, can I merge, готовий до PR, чи можна мержити, перевір мої зміни."
allowed-tools: Read, Write, Grep, Glob, Bash, Skill
metadata:
  tags: review, pre-pr, quality-gate, diff-routing, skills-orchestration
---

# PR Self-Review

A quality gate that runs **before** a pull request is opened. It reviews only
what changed, using the skills this repo already has, and refuses to let a
change through when something is genuinely broken.

Three rules define this skill. Everything else is detail:

> 1. **Only lines in the diff.** Pre-existing debt is not this review's business.
> 2. **CRITICAL means broken, not imperfect.** Style is never CRITICAL.
> 3. **Cheap deterministic checks run before any LLM pass.**

Companion files — read them when you reach the step that needs them:
[`routing.md`](routing.md) (which skills for which files),
[`severity.md`](severity.md) (normalising verdicts, anti-noise contract),
[`report-template.md`](report-template.md) (output shape).

## When to use

- Before `gh pr create` — this is the primary trigger, enforced by a hook.
- On explicit request: `/pr-self-review`.
- Before pushing a branch someone else will review.

Do **not** use it as a general code reviewer for the whole repo; it reviews a
diff, nothing else.

## Modes

| Invocation | Behaviour |
|-----------|-----------|
| `/pr-self-review` | Full run, report only. Never edits files. |
| `/pr-self-review --fix` | Full run, then applies **mechanical** fixes and re-runs. Never runs automatically. |
| `/pr-self-review --with-tests` | Also runs the test suites of affected packages in step 0. Slower. |

---

## Step 0 — Collect the changes

All commands are read-only.

```bash
git rev-parse --abbrev-ref HEAD                   # current branch
git fetch origin main --quiet                     # may fail offline — see below
git merge-base HEAD origin/main                   # -> $BASE
git diff --name-status $BASE                      # branch commits + working tree
git diff --name-status --cached                   # staged
git ls-files --others --exclude-standard          # untracked
git diff $BASE --stat                             # size
```

Rules:

- **`git fetch` needs the network.** If it fails, do not stop: fall back to the
  local `origin/main`, then `main`, then `HEAD~1`, and state in the report that
  the comparison base may be stale.
- **On `main` with no branch:** compare the working tree only, and warn that a
  PR is not opened from `main`.
- **Untracked files** have no diff — read them in full.
- **Always excluded:** `server/clones/**`, `**/node_modules/**`, `**/dist/**`,
  `*.lock`, `pnpm-lock.yaml`, `*.tsbuildinfo`.
- **Over 60 changed files:** review in batches by domain (backend → UI → DB →
  rest), one pass each. Never truncate silently — say in the report that the run
  was batched and how many batches. The verdict is issued only after **all**
  batches complete; if one does not, write no result file and leave the gate shut.

If nothing changed: report that, write no result file, stop.

---

## Step 1 — Deterministic checks (before any LLM pass)

Typechecking and import-graph analysis answer CRITICAL-class questions for free
and without false positives. Spending ten LLM passes on a diff that does not
compile is waste.

| Check | Where | Run when | On failure |
|-------|-------|----------|-----------|
| `pnpm typecheck` | each affected package | any `*.ts`/`*.tsx` changed | **CRITICAL → immediate BLOCK**, skip LLM passes |
| `pnpm arch:check` | `server/`, `reviewer-core/` | backend files changed | **CRITICAL** — layer violation proven by the import graph |
| `pnpm lint` | `client/` | client files changed | **HIGH** (CRITICAL only if a rule is error-level and about correctness) |
| `pnpm test` | affected package | only with `--with-tests` | CRITICAL |

Packages are independent — always `cd` into the package, never run from the root.

```bash
cd server        && pnpm typecheck && pnpm arch:check   # if server/** changed
cd reviewer-core && pnpm typecheck && pnpm arch:check   # if reviewer-core/** changed
cd client        && pnpm typecheck && pnpm lint         # if client/** changed
```

Scripts differ per package — `arch:check` exists in `server/` and
`reviewer-core/` only, `lint` in `client/` only. Before running any of them,
confirm the script exists in that package's `package.json`; if it does not, skip
the row silently. Never report a missing script as a finding, and never invent a
command the package does not define.

Division of labour: **tools catch what the type system and import graph prove;
the LLM catches what needs reading the meaning** — whether a layer is right in
substance, not merely in arrow direction.

### Read exit codes correctly, and tell tool failure from code failure

Two traps, both verified on this repo:

**1. Never pipe a check into `tail`/`head` when you need its exit code** — the
pipe returns the exit code of `tail`, so a failing command reads as success:

```bash
pnpm typecheck 2>&1 | tail -15   # ← always exit 0. Silently wrong.
pnpm typecheck > /tmp/tc.log 2>&1; echo "exit=$?"   # ← correct
```

Run the check redirected to a file, capture `$?`, then read the file.

**2. A non-zero exit is not automatically a code problem.** `pnpm` runs a
dependency check before the script and fails *before the script ever executes*.
On this machine `pnpm typecheck` exits 1 with `ERR_PNPM_IGNORED_BUILDS` — an
environment issue, not a type error.

Classify before judging:

| Output contains | Meaning | Action |
|-----------------|---------|--------|
| `ERR_PNPM_*`, `Command failed with exit code 1: … pnpm install`, `Cannot find module`, `EACCES`, `ENOENT` on a binary, `SyntaxError` inside `node_modules/.bin/` | environment / tooling | **Not a finding.** Report the check as `⚠️ could not run` and say why. Continue to step 2. |
| `error TS####:` | real type error | **CRITICAL → BLOCK** |
| dependency-cruiser `error … violates` | real layer violation | **CRITICAL → BLOCK** |
| dependency-cruiser `warn <rule-name>:` | layer smell | **HIGH**, and only for files in the diff |

**3. `arch:check` exits 0 while reporting violations.** dependency-cruiser is
configured here with `warn`-severity rules, so 20 violations still exit 0.
Judging by exit code alone misses every one of them. Always parse the summary
line — `x N dependency violations (E errors, W warnings)` — and read the `warn`
lines, not just `$?`.

Do not report the whole list: this repo currently carries ~20 pre-existing
warnings (`service-no-container`, `no-circular`, `routes-no-persistence`). Only
violations whose file is **in the diff** are findings. A pre-existing warning in
an untouched file is debt, not a blocker.

### When pnpm itself will not run

If `pnpm <script>` fails on the dependency pre-check, retry once by invoking the
tool directly — this bypasses pnpm without changing what is checked:

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/dependency-cruiser/bin/dependency-cruise.mjs src --config .dependency-cruiser.cjs
```

Do **not** call `node_modules/.bin/<tool>` — on Windows those are shell shims and
node fails on them with `SyntaxError`. Use the package's real entry point.

If the direct call also fails, mark the check `⚠️ could not run` and continue.

A check that could not run is not a passed check. Say so in the report header
(`typecheck ⚠️ not run — pnpm install failed`) rather than implying it was
green. Do not let an unrunnable check produce a `BLOCK` — that punishes the
author for a broken local environment.

A genuine typecheck failure, by contrast, is a complete result: report it, write
the `BLOCK` result file, stop. Do not continue to step 2.

---

## Step 2 — Guard rules (cheap, no LLM)

Grep the diff for these before routing. Each is CRITICAL on its own:

| Guard | Pattern / condition | Why |
|-------|--------------------|-----|
| Secret in diff | `sk-`, `ghp_`, `AKIA`, `-----BEGIN.*PRIVATE KEY` | Secrets live in `~/.devdigest/secrets.json`, never in git |
| Schema without migration | `server/src/db/**` changed, no new file in `server/src/db/migrations/**` | Migrations do not run on boot; a missing one breaks every environment |
| Import from clones | any import path containing `clones/` | Third-party checkouts are not dependencies |
| Secrets in config | new key in `AppConfig` whose name matches `token|secret|key|password` | Secrets must not reach `AppConfig` or the DB |

And one HIGH:

| Guard | Condition | Why |
|-------|-----------|-----|
| Misnamed DB test | a test file opening a real DB connection, not named `*.it.test.ts` | It silently lands in the hermetic suite and breaks CI |

Guard hits are reported with file and line like any other finding, but they need
no LLM pass to justify — the pattern *is* the proof.

---

## Step 3 — Route the diff to skills

Read [`routing.md`](routing.md) and build the set of skills to run. A file may
match several rows; skills are unioned, never duplicated.

For each domain that has at least one changed file:

1. Load its skills via the `Skill` tool, one at a time.
2. Give each skill **only the slice of the diff for its domain** — never the
   whole diff. This is what keeps findings precise.
3. Collect findings in normalised form:

```
{ file, line, severity, skill, rule, what, why, fix }
```

Domains are independent, so work through them in whatever order is cheapest —
but do this inline. **Do not spawn subagents**; the whole point is a fast local
gate, and a cold subagent re-derives context you already hold.

---

## Step 4 — Normalise, verdict, report

Read [`severity.md`](severity.md) to map each skill's own scale onto
CRITICAL / HIGH / MEDIUM, and to apply the anti-noise contract before anything
reaches the report.

Verdict:

| Verdict | Condition | Meaning |
|---------|-----------|---------|
| `BLOCK` | ≥1 CRITICAL | **The PR must not be opened.** List every blocker with a concrete fix. |
| `WARN` | 0 CRITICAL, ≥1 HIGH | PR may be opened; carry the HIGH list into its description. |
| `PASS` | nothing above MEDIUM | Clear. |

Format the output per [`report-template.md`](report-template.md). The report
itself is written in the conversation language; file paths, rule names and skill
names stay verbatim.

### Write the result file

The hook that guards `gh pr create` reads this — without it the gate cannot
work. Write it as the **last** action of the run:

```jsonc
// .git/pr-self-review-result.json  (inside .git/ — never committed)
{
  "sha": "<git rev-parse HEAD>",
  "verdict": "PASS" | "WARN" | "BLOCK",
  "criticalCount": 0,
  "highCount": 2,
  "timestamp": "<ISO 8601>",
  "batched": false
}
```

The `sha` matters as much as the verdict: the hook denies the PR when the
recorded SHA differs from the current `HEAD`, so a review followed by more edits
does not count as passed.

Do not write the file when the run did not complete (aborted batch, crashed
check). A missing file means "not reviewed", which the hook treats as denial —
that is the correct outcome.

---

## After a BLOCK

A verdict with no next step makes this a doorman. So:

- Every CRITICAL **must** carry a concrete fix — what to change, not "reconsider
  the approach".
- Offer `/pr-self-review --fix` for the mechanical ones: import order, moving a
  type into a port, renaming a DB test, deleting a stray secret. Re-run
  afterwards; a fix is not done until the re-run is clean.
- Substantive fixes stay with the human. `--fix` must say plainly which findings
  it is leaving alone.
- `--fix` never runs on its own — only on explicit request.

## On PASS or WARN

1. Emit the PR-body block from [`report-template.md`](report-template.md) so the
   author can paste it straight into the pull request.
2. Then run the `engineering-insights` skill to record anything non-obvious the
   run surfaced — a recurring finding pattern, a false positive worth
   calibrating, a routing gap.

Skip the insights step entirely on `BLOCK`: the lesson is not finished while the
blockers are unfixed, and the entry would mix into an incomplete repair.
