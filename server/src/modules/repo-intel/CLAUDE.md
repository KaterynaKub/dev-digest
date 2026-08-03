# modules/repo-intel

The codebase indexer: symbols, import graph, PageRank file importance, cached
repo map. Read-only at review time.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Everything downstream goes through the facade (contract in `types.ts`),
  resolved once as `container.repoIntel` and injected as the `repoIntel` port —
  consumers never reach for the container. Never import from `pipeline/` or hit
  the tables.
- The service and the pipeline share one port set: `RepoIntelDeps extends
  IndexPipelineDeps`, so `this.deps` forwards straight into `runFullIndex` /
  `runIncremental`.
- Indexing happens on clone/fetch, never at request time.
- Degrade, never throw: an unindexed repo returns empty results so callers fall
  back to diff-only.
- Gated by BOTH `REPO_INTEL_ENABLED` and the per-agent `repo_intel` flag.
- Most facade methods have no caller in the starter — intentional, not dead code.
- `getConventionSamples` IS consumed (by `../conventions`). Its junk filter
  excludes eslint/prettier/`.config.` and `walkClone` never indexes `.json`, so
  config files are the CALLER's problem — that module probes them by exact path.

## Use when

- Pipeline, full facade method list → read `README.md` (in this folder)
- How reviews consume it → read `../reviews/CLAUDE.md`
