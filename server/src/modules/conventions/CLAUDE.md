# modules/conventions

Extracts code-style house-rules from a cloned repo, grounds each one against
real code, and merges the accepted ones into a Skill draft.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md`,
`../../../specs/0002-conventions-extractor.md` first.

## Conventions (not obvious from code)

- Sample selection is **code-only — no model decides which files are read**.
  Configs come from `CONFIG_PROBE_PATHS` (exact-path `git.readFile` probes),
  source files from `repoIntel.getConventionSamples`. `MockLLMProvider`'s
  `structuredBySchema` mentions a `'ConventionFileSelection'` key: it is
  RESERVED AND UNUSED. An integration test asserts exactly one
  `completeStructured` call per scan, which is what pins this down.
- Config files CANNOT come from repo-intel: `walkClone` only indexes
  `SUPPORTED_EXT` (so `package.json`/`tsconfig.json` are never in the index at
  all), and `getConventionSamples` additionally filters `eslint`/`prettier`/
  `.config.` out via `JUNK_PATH_PATTERNS`. The probe list is the compensating
  mechanism and must not be "simplified" into a repo-intel call.
- `verifyCandidates` is a MECHANICAL gate, never a second model call — it
  mirrors `reviewer-core`'s `groundFindings` kept/dropped shape. The check that
  actually stops hallucinations is `end_line <= lineCount(content)`: a model
  that invents a rule also invents a plausible `:230-245` in a 40-line file.
- **The evidence snippet is sliced off disk by us**, from the cited line range —
  it is deliberately NOT part of `ConventionExtraction`, so the model cannot
  supply it and cannot get it wrong.
- Line numbers (`NNN| `) are prefixed by `numberLines` before the file reaches
  the prompt. Without them the model cannot produce a range that verifies, and
  the gate would reject every candidate.
- Re-scan is a MERGE, not a truncate: rows a human touched
  (`status <> 'pending'` OR `edited = true`) are carried forward and re-pointed
  at the new scan; untouched `pending` rows from older scans are deleted; a new
  candidate is skipped when a carried-forward row has the same `evidencePath`
  and a normalised-equal rule. This is the answer to "how does an accepted
  convention survive a re-scan" and is not derivable from the schema.
- There is deliberately NO unique constraint on `(repoId, rule)` — the model
  paraphrases, so one semantic rule yields textually different rows across
  scans. Dedup is fuzzy and lives in `isDuplicateRule`, which is CONSERVATIVE
  on purpose: a near-miss shown as a second card can be rejected in one click,
  a rule silently swallowed cannot be recovered.
- Model choice resolves in three layers: request body → workspace
  `feature_models` override → `DEFAULT_CONVENTIONS_MODEL`. A PARTIAL request
  (only `provider`, or only `model`) is ignored entirely rather than merged
  with the override, because mixing sources produces a pair that does not
  exist. The per-scan choice is never persisted to settings.
- This module reads the override with `getFeatureModelOverride`, NOT
  `resolveFeatureModel`, so its own cheap default survives — exactly what that
  helper's doc comment prescribes.
- A scan with nothing to sample records a `sample_count: 0` row and spends
  ZERO model calls. The scan row is only written inside the final transaction,
  so a provider failure never corrupts the "last scan" timestamp.
- Skills created from a draft use `source: 'extracted'`, so
  `SkillsService.create` forces `enabled: false`. That vetting gate is NOT
  weakened here; the client's Enabled toggle is rendered read-only and says so.

## Use when

- Skill creation / the vetting gate → read `../skills/CLAUDE.md`
- Sampling contract and its junk filter → read `../repo-intel/CLAUDE.md`
- Feature-model resolution → read `../settings/CLAUDE.md`
