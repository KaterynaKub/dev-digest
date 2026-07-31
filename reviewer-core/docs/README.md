# reviewer-core — docs

Deep-dives on the engine: prompt anatomy, the grounding algorithm, structured
output and repair, injection defense rationale.

Naming: `short-slug.md`, one topic per file.

## What belongs here

- Why the prompt is shaped the way it is, section by section.
- How grounding matches a finding to a diff line, including edge cases.
- Structured-output handling: JSON Schema generation, parse-with-repair.

## What does not

- Non-obvious facts and traps → `../INSIGHTS.md`
- Proposed engine changes → `../specs/`
- The pipeline diagram and public API → already in `../README.md`; link instead

## Rules

- Explain intent, not line-by-line code — the engine is small and readable.
- When documenting a defense, state the attack it stops and the one it does not.
