# Specifications

Requirement specifications for Spec-Driven Development. One file per feature,
written **before** the implementation plan.

A specification answers *what the system must do, for whom, and how we will
know it is done*. It never answers *how we will build it* — that is
`.claude/plans/`.

## Naming

```
docs/specs/SPEC-NN-short-slug.md
```

`NN` is sequential across the whole repo, never reused, never renumbered.

## Ownership

| Directory | Holds | Written by |
|---|---|---|
| `docs/specs/` | requirements — this directory | [`spec-creator`](../../.claude/agents/spec-creator.md) |
| `.claude/plans/` | implementation plans | [`implementation-planner`](../../.claude/agents/implementation-planner.md) |
| `<package>/specs/` | historical per-package specs, `e2e/*.flow.json` | humans only |

The full template, the EARS rules, and the design-review checklist live in
[`.claude/agents/spec-creator.md`](../../.claude/agents/spec-creator.md) — that
file is the single source of truth, deliberately not duplicated here.

## Sections

Every spec carries all of these, in order. A section with nothing to say says
`None.` — a missing section reads as "not considered".

`Problem and user` · `Goals / Non-goals` · `User stories` ·
`Acceptance criteria (EARS)` · `Edge cases` · `Non-functional requirements` ·
`Inputs and provenance` · `Untrusted inputs` · `Design review` ·
`Module interactions` · `Traceability` · `Verification notes` ·
`Open questions`

`Traceability` is a table linking every `AC-n` / `NFR-n` to the story it serves,
where it came from, and what kind of check verifies it — nothing orphaned in
either direction. `Verification notes` says what kind of verification the
feature demands (hermetic, `*.it.test.ts`, e2e flow, human review) and records
the traps that make a check lie about its own result.

## Acceptance criteria are written in EARS

[EARS](https://alistairmavin.com/ears/) (Mavin, Wilkinson, Harwood & Novak,
IEEE RE'09) separates the condition from the system's response, so a
requirement can be checked rather than argued about. Specs are written in
English; `shall` marks obligation.

| Pattern | Form |
|---|---|
| Ubiquitous | The system shall … |
| Event-driven | **WHEN** \<trigger\>, the system shall … |
| State-driven | **WHILE** \<state\>, the system shall … |
| Unwanted behaviour | **IF** \<condition\>, **THEN** the system shall … |
| Optional feature | **WHERE** \<feature enabled\>, the system shall … |

The bar: a criterion is verifiable when a test can assert it or a reviewer can
observe it. "Shall handle it gracefully" is not a requirement.

Non-functional requirements are written the same way, numbered `NFR-n`, and
cover performance, scale limits, degradation, determinism, observability,
accessibility, and security — each either answered or marked `N/A`, so a reader
can tell "considered and irrelevant" from "forgotten".

## Rules

- `Status` stays current: `draft` → `approved` → `implemented`. A stale
  `draft` is worse than no spec.
- A decision that genuinely reverses gets a **new** spec with
  `Supersedes: SPEC-MM`; the old one becomes `superseded by SPEC-NN`. History
  is not rewritten.
- Link, do not restate: point at `../../README.md` or a package `CLAUDE.md`.
- Durable non-obvious findings belong in `INSIGHTS.md`, not here. Specs are
  requirements; insights are live guidance.
