# modules/project-context

Serves the repository's own markdown — the PRDs, architecture notes and
invariants already living under the configured context roots — as documents a
user can browse, read, edit in the working tree, and attach to an agent or a
skill. Attached documents are injected into every run's `## Project context`
prompt block by `reviews/run-executor.ts#buildProjectContext`.

Discovery walks the clone through the `GitClient` port; nothing here parses,
chunks or embeds markdown, and no value this module shows is model-generated.

## Before answering

Search `../../../../docs/specs/SPEC-01-project-context-folder.md`,
`../../../INSIGHTS.md`, and `../repo-intel/CLAUDE.md` first.

## Conventions (not obvious from code)

- **`specs` carries RAW text — never pre-wrap it.** `reviewer-core`'s
  `assemblePrompt` wraps each element itself via `wrapUntrusted('spec-N', …)`
  (`reviewer-core/src/prompt.ts`), unlike `skills`/`intent`, which arrive
  already wrapped. Wrapping here would nest the delimiters twice and make the
  trace misrepresent what was injected (AC-41). The truncation marker is the
  one thing appended *before* handing text over, so the wrapper covers it too.
- **The 20-document limit is validated in `service.ts`, not in
  `AgentsRepository.update`.** Attachments are deliberately outside the
  versioned configuration (NFR-23): `agent_versions` does not snapshot them and
  `AgentVersionConfig` is unchanged. Putting the check on the update path would
  drag attachments back onto version bumping. The cost is recorded, not hidden —
  a past run's document set is recoverable only from that run's trace (NFR-24),
  never from the agent's current attachments.
- **`specs_read` in a trace is a union with the old shape.** Traces persisted
  before this feature hold plain `string` paths; the contract is
  `z.array(z.union([z.string(), ContextDocRead]))`. No server layer parses a
  trace (`run.repo.ts` casts raw, `hooks/trace.ts` too), so a widened shape will
  not fail here — it breaks the client renderer instead. Any change to the
  element shape is a two-file vendored edit plus a client-side render check.
- **Containment is checked twice, on purpose.** `helpers.ts#isContainedPath` is
  the primary guard and runs before any filesystem access;
  `SimpleGitClient.writeFile`'s own `relative()` check is defence in depth at
  the adapter boundary. Never rely on the adapter's check alone. The
  `ContextRoot` schema adds a third, per-segment check — a character-class
  regex alone accepts `..` as a segment (see `INSIGHTS.md`).
- **A read that throws and a read that returns `''` are the same outcome.**
  `SimpleGitClient.readFile` rejects on a missing file; `MockGitClient.readFile`
  returns `''`. Both mean "missing" (AC-36) — a test built on only one of them
  passes while the other shape fails the run.
- **`EXCLUDED_DIRS` is imported from `../repo-intel/constants.js`, never
  copied.** AC-2 requires the same set the indexer uses; a copy would drift
  silently.
- **Logs carry paths, sizes and counts — never document text** (NFR-17). The
  write path logs from `routes.ts`, where `req.log` exists; `service.ts` has no
  logger of its own and must not gain one for this.

## Use when

- Feature intent, acceptance criteria, provenance →
  read `../../../../docs/specs/SPEC-01-project-context-folder.md`
- Run-time injection, budget, truncation, trace →
  read `../reviews/run-executor.ts#buildProjectContext`
- Indexer's excluded-directory set and clone walking →
  read `../repo-intel/CLAUDE.md`
