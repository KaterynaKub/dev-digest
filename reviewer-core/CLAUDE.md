# reviewer-core — the review engine

Pure pipeline: diff → prompt → LLM → grounded findings. No DB, no GitHub, no
filesystem. The only side effect is a call through an injected `LLMProvider`.

## Before answering

Search `docs/`, `specs/`, `INSIGHTS.md` first.

## Conventions (not obvious from code)

- Grounding is mandatory: a finding not citing a line in the diff is dropped.
  Never add a bypass.
- The score is recomputed from surviving findings — the model's own score is
  ignored by design.
- Injection defense is ONE trusted rule (`INJECTION_GUARD`), never keyword
  scanning of untrusted text.
- The package emits no JS — `build` is a type-check; the server consumes the TS
  source via path alias. Do not add a `dist/`.
- Empty prompt slots omit their whole section, never an empty heading.

## Use when

- Pipeline diagram, public API → read `README.md`
- Deep-dives → read `docs/` · specs → read `specs/` ·
  findings → read `INSIGHTS.md`
- What the server actually feeds in → read `../server/src/modules/reviews/CLAUDE.md`
