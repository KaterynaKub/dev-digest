# Severity — normalising findings into one scale

Every skill grades on its own scale: `react-best-practices` uses
CRITICAL/HIGH/MEDIUM, `security` uses HIGH/MEDIUM/LOW *confidence*,
`onion-architecture` is binary (violation or not), `zod` and
`postgresql-table-design` mostly state rules without grades at all. A single
verdict needs one scale.

## The three levels

| Level | Definition | Effect |
|-------|-----------|--------|
| **CRITICAL** | The change is broken: it crashes, corrupts, leaks, lets the wrong party in, or cannot ship. Provable with a concrete failure scenario. | **BLOCK** |
| **HIGH** | Real problem, ships anyway: performance cliff, maintenance trap, missing index, weakened boundary. | WARN |
| **MEDIUM** | Improvement worth knowing about: naming, structure, minor perf. | Informational |

## Mapping table

| Source | Source grade | → | Condition |
|--------|-------------|---|-----------|
| guard rules (`SKILL.md` step 2) | secret / schema-without-migration / `clones/` import | **CRITICAL** | pattern is the proof |
| guard rules | misnamed DB test | **HIGH** | — |
| `typecheck` / `arch:check` | any failure | **CRITICAL** | the tool proved it |
| `onion-architecture` | inner layer imports outer | **CRITICAL** | dependency rule is the one rule that keeps the onion from rotting |
| `onion-architecture` | Container god-object, port not injected explicitly | **HIGH** | — |
| `security` | HIGH confidence (vulnerable pattern **and** attacker-controlled input confirmed) | **CRITICAL** | — |
| `security` | MEDIUM confidence (input source unclear) | **HIGH** | never CRITICAL — unconfirmed by definition |
| `security` | LOW confidence | **drop** | that skill says not to report these |
| `react-best-practices` | CRITICAL | **CRITICAL** | broken reconciliation, hook-order violation |
| `react-best-practices` | HIGH | **HIGH** | — |
| `react-best-practices` | MEDIUM | **MEDIUM** | — |
| `next-best-practices` | server/client boundary leak exposing secrets | **CRITICAL** | — |
| `next-best-practices` | everything else | **HIGH** / **MEDIUM** by impact | — |
| `ui-frontend-architecture` | cross-feature import bypassing a public API | **HIGH** | — |
| `drizzle-orm-patterns` / `postgresql-table-design` | data loss, missing migration, wrong money type | **CRITICAL** | — |
| `postgresql-table-design` | missing FK index, nullable that should not be | **HIGH** | Postgres does not auto-index FKs |
| `zod` | unvalidated external input crossing the HTTP boundary | **CRITICAL** | — |
| `zod` | `parse` where `safeParse` belongs, weak schema | **HIGH** | — |
| `typescript-expert` | `any` erasing a real contract, unsound cast hiding a bug | **HIGH** | — |
| anything | style, naming, formatting, preference | **MEDIUM** | never higher |

## Promotion rule

A finding reaches CRITICAL **only** when all three hold:

1. A specific file and line, inside the diff.
2. A concrete failure scenario: what input or state produces what wrong result.
3. The scenario is reachable in this codebase — not merely possible in theory.

Miss any one → HIGH at most. Adapted from the confidence table in the `security`
skill, and it is the difference between a gate people trust and one they bypass.

## Anti-noise contract

Apply before anything reaches the report. A noisy gate gets switched off, and a
switched-off gate catches nothing.

1. **Only lines in the diff.** Never report a finding in a file that is not in
   the diff, or on a line that was not touched. Pre-existing debt is out of
   scope. One exception: a changed line **breaks** existing code elsewhere — then
   report it with the failure scenario.
2. **CRITICAL is for broken, not imperfect.** Best-practice deviations, style
   and naming never reach CRITICAL, however confidently a skill words them.
3. **One pattern, one finding.** The same issue in five files is a single
   finding listing five locations, not five findings.
4. **Respect documented trade-offs.** A finding contradicting an explicit
   decision in the package's `INSIGHTS.md` or `CLAUDE.md` is not a finding —
   unless the change itself invalidates that decision, which must be stated.
5. **Silence is a valid result.** `PASS` with zero findings does not mean the
   review failed. Inventing findings to look useful is the fastest way to lose
   the gate.
6. **No speculation about intent.** Review the diff, not the plan behind it.
   "This probably should have been done differently" is not a finding.

## Verdict

| Verdict | Condition |
|---------|-----------|
| `BLOCK` | ≥1 CRITICAL |
| `WARN` | 0 CRITICAL, ≥1 HIGH |
| `PASS` | otherwise |

MEDIUM findings never affect the verdict. They are reported, collapsed, and
carry no obligation.
