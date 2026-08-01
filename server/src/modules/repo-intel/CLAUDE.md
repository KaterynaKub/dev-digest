# modules/repo-intel

The codebase indexer: symbols, import graph, PageRank file importance, cached
repo map. Read-only at review time.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Everything downstream goes through the facade (`container.repoIntel.*`,
  contract in `types.ts`). Never import from `pipeline/` or hit the tables.
- Indexing happens on clone/fetch, never at request time.
- Degrade, never throw: an unindexed repo returns empty results so callers fall
  back to diff-only.
- Gated by BOTH `REPO_INTEL_ENABLED` and the per-agent `repo_intel` flag.
- Most facade methods have no caller in the starter — intentional, not dead code.

## Use when

- Pipeline, full facade method list → read `README.md` (in this folder)
- How reviews consume it → read `../reviews/CLAUDE.md`
