# 0002 — Conventions extractor

**Status:** done
**Date:** 2026-08-04
**Touches:** src/modules/conventions · src/db/schema/knowledge.ts · src/prompts/conventions.system.md · src/platform/container.ts

## Problem

A repo's house-rules (naming, error handling, validation, module layout) live
only in reviewers' heads. Skills Lab can hold them as a Skill, but somebody has
to write that Skill by hand, from memory, and nothing checks that the rules
described are the rules the code actually follows.

The obvious automation — ask a model to describe a codebase's conventions — is
exactly the shape that produces confident, unfalsifiable output: plausible
rules citing plausible files at plausible line numbers, none of which a reader
verifies before pasting them into an agent's prompt.

## Approach

Extract candidates with ONE cheap model call, then ground every one of them in
code before it can be shown, let alone persisted.

1. **Sampling — code only, no model.** Config files by exact-path probe
   (`CONFIG_PROBE_PATHS` via `git.readFile`); source files from
   `repoIntel.getConventionSamples(repoId, 12)`. Configs need their own
   mechanism because `walkClone` never indexes `.json` and
   `JUNK_PATH_PATTERNS` filters eslint/prettier out.
2. **Prompt.** `src/prompts/conventions.system.md`, with every file body wrapped
   in `wrapUntrusted` and prefixed with `NNN| ` line numbers by `numberLines`.
3. **One structured call** returning `{category, rule, evidence_path,
   evidence_start_line, evidence_end_line, confidence}`. No snippet: the model
   is not trusted to reproduce code.
4. **The gate** (`verifyCandidates`, pure): file was sampled → file non-empty →
   range sane → **range exists in the file** → sliced text non-blank → rule
   substantive and not an intra-batch duplicate. Survivors get their snippet
   sliced off disk by us.
5. **Persist** scan + survivors in one transaction, carrying forward rows a
   human already decided on.
6. **Merge** accepted rows into a `ConventionSkillDraft` (server-built
   markdown), which the client edits and saves through the existing
   `POST /skills`.

New tables: `conventions` (rewritten — it existed unused) and
`convention_scans`. Migrations `0012` (drop legacy) + `0013` (create).

## Rejected alternatives

- **Model-driven file selection** (the two-step `ConventionFileSelection` →
  `ConventionExtraction` dialogue the mock's comment anticipated). Doubles cost
  and latency to pick files a rank query already picks better, and adds a
  second failure mode. The mock's key is left in place, marked reserved/unused.
- **Trusting the model's snippet.** Cheaper to implement, but it makes the
  snippet unfalsifiable — the one thing a reviewer actually reads. Slicing it
  from the cited range means the snippet and the range cannot disagree.
- **A unique constraint on `(repoId, rule)`.** The model paraphrases, so this
  would either reject a legitimate rephrasing or silently drop it. Fuzzy dedup
  in code is inspectable; a constraint violation at 2am is not.
- **Deleting all rows on re-scan.** Simple, and it throws away human decisions.
  Carry-forward is more code for the one behaviour users would otherwise
  report as a bug.
- **Relaxing the skills vetting gate** so the modal's Enabled toggle could
  write through (e.g. a `vetted: true` flag on `POST /skills`). That gate is
  the single place imported content is held back; punching a hole in it for UI
  convenience would invite every future import path through the same hole. The
  toggle is read-only instead, and says why.
- **A `boolean accepted` column** (what the legacy table had). Cannot express
  "explicitly rejected" vs "not yet reviewed", so "Reject all" would resurrect
  on reload.

## Acceptance

- [x] `POST /repos/:id/conventions/extract` returns only candidates whose cited
      file AND line range exist in the sampled content.
- [x] A fixture with one valid + one file-hallucinating candidate persists
      exactly one row, and the scan records `candidates_raw: 2, kept: 1`.
- [x] Exactly ONE `completeStructured` call per scan.
- [x] Config files are read even though `getConventionSamples` never returns them.
- [x] A repo with nothing to sample spends zero model calls.
- [x] A repo without a clone → 422, and no scan row is written.
- [x] Re-scan carries forward accepted/edited rows and drops stale pending ones.
- [x] `GET .../skill-draft` contains every accepted rule and no pending one.
- [x] The merged draft saves through `POST /skills` and lands `enabled: false`.
- [x] Per-scan model choice reaches the provider and is recorded on the scan,
      without being written to `settings`.
- [x] `pnpm arch:check` reports no new violations.

## Risks

- `getConventionSamples` returns `[]` for an unindexed repo (documented
  degradation, never throws) — the UI then shows an empty scan rather than an
  error. Mitigated by recording `sample_count: 0` so the page can explain why.
- The evidence gate is only as good as the sampled window: a file truncated at
  `MAX_FILE_CHARS` can make a legitimate citation past the cut-off look
  hallucinated. Accepted — a false drop is cheaper than a false rule.
