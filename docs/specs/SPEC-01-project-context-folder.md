# Spec: Project Context Folder

Spec ID: SPEC-01
Status: approved

## Problem and user

A reviewer agent today sees the diff, its linked skills, derived PR intent, and
repo-intel context. It does not see the project's own written rules — the PRDs,
architecture notes, and invariants that already live as markdown in the
repository under `specs/`, `docs/`, and `insights/`.

Two roles are blocked:

- **The agent author** (the person configuring a review agent in Skills Lab)
  can express a project rule only by retyping it into a skill body. The rule
  then exists twice and drifts from the document that owns it.
- **The PR reviewer** reading a run trace cannot tell whether the agent knew
  about a documented invariant, because there is nothing in the trace that
  says which project documents the run read.

The plumbing for this is already half-built and inert. `reviewer-core`'s
`assemblePrompt` accepts a `specs?: string[]` slot and renders a
`## Project context` section; `RunTrace.specs_read` exists in the contract and
the run-trace drawer already renders both a `Specs read` row and a
`Project context` prompt block. Every one of them is permanently empty, because
`run-executor.ts` hardcodes `specs_read: []` and never passes `specs`. Nothing
in the product can currently fill them.

## Goals / Non-goals

**Goals**

1. Let a user browse every markdown document the repository already contains
   under the configured context roots, and read one in place.
2. Let a user manually attach specific documents to an agent and to a skill,
   in a deterministic order they control.
3. Show, before any run, an estimated token cost per document, per attachment
   set, and across the whole discovered set, so the user knows what each prompt
   will carry and what the available material would cost.
4. At run time, read the attached documents from the repository and inject
   their text into the existing `## Project context` prompt block as untrusted
   data.
5. Make the result auditable: the run trace names every document read, its
   size, and its origin, and the assembled block is readable in full.

**Non-goals**

- **Automatic relevance selection.** Choosing documents by PR content is a
  separate feature. Selection here is manual only.
- **Indexing, chunking, or embedding of markdown.** No `.md` is parsed into
  chunks and nothing is vectorised. Mockup 1's `1,240 chunks` counter is an
  artefact of the automatic-selection feature and is replaced by a summed token
  estimate (AC-57), not reproduced.
- **A `COVERAGE` metric.** Mockup 1's `78 COVERAGE` ring has no agreed
  definition and is excluded rather than rendered as a placeholder.
- **Committing or pushing document edits.** Editing writes to the clone's
  working tree only (see AC-20…AC-23); `git commit` and `git push` from the UI
  are out of scope.
- **Creating, uploading, renaming, or deleting documents.** Mockup 1's
  new-file, new-folder, and upload toolbar icons are excluded; the reader is
  read-and-edit-existing only.
- **`Evals`, `Stats`, and `CI` tabs** shown on mockups 2 and 3. This feature
  adds only the `Context` tab.
- **Documents from outside the repository**, including a `.devdigest/specs/`
  folder.
- **Versioning of attachments.** Attaching, detaching, or reordering documents
  does not create an agent or skill version (NFR-23). The consequence for
  replaying a past run is stated under Non-functional requirements.

## User stories

- **US-1.** As an agent author, I want to browse the repository's markdown
  documents in one place, so that I can find the spec that states a rule
  without leaving the studio.
- **US-2.** As an agent author, I want to read a document's rendered content in
  the studio, so that I can confirm it says what I think before attaching it.
- **US-3.** As an agent author, I want to attach documents to an agent and
  order them, so that every run of that agent carries exactly the project rules
  I chose.
- **US-4.** As a skill author, I want to attach documents to a skill, so that
  every agent using that skill inherits the same grounding without me
  re-attaching them per agent.
- **US-5.** As an agent author, I want to see the estimated token cost of my
  attachments before I run, so that I can judge what I am adding to every
  prompt.
- **US-6.** As a PR reviewer, I want the run trace to name the documents the
  run read and let me read the exact injected text, so that I can tell whether
  a finding was grounded in a documented rule.
- **US-7.** As a repository maintainer, I want to control which directories are
  offered as context, so that the list matches where this project actually
  keeps its documentation.
- **US-8.** As a document owner, I want to correct a document's text in the
  studio and be told plainly that the correction is not committed, so that I am
  not misled into thinking it is saved permanently.

## Acceptance criteria (EARS)

### Discovery and reading

- **AC-1.** WHEN the user opens the Project Context page for a repository, the
  system shall list every file matching `**/*.md` under the workspace's
  configured context roots within that repository's clone, each shown with its
  repository-relative path.
- **AC-67.** The system shall scope the Project Context page to exactly one
  repository, so every document it lists comes from that repository's clone.
- **AC-2.** The system shall exclude from that listing every directory in the
  indexer's existing excluded-directory set (`node_modules`, `dist`, `build`,
  `coverage`, `.next`, `out`, `vendor`, `.git`).
- **AC-3.** WHEN the document listing is displayed, the system shall show a
  status line stating the number of documents found.
- **AC-4.** WHEN the user selects a document, the system shall display that
  document's current text rendered as markdown.
- **AC-5.** IF the configured context roots match no file in the repository,
  THEN the system shall display an empty state naming the roots that were
  searched.
- **AC-6.** IF the repository has no local clone, THEN the system shall display
  a state distinguishing "not cloned yet" from "no documents found".
- **AC-57.** WHEN the document listing is displayed, the system shall show in
  that status line the summed estimated token count of every document in the
  listing.
- **AC-58.** WHEN the document listing is displayed, the system shall show in
  that status line the time at which the listing was produced.
- **AC-59.** The system shall compute the summed estimate of AC-57 with the
  same encoding and the same approximation marker and explanation required of
  every other displayed token figure, introducing no second method of counting.
- **AC-60.** IF the character-based fallback of AC-18 was used for any document
  contributing to the summed estimate, THEN the system shall indicate that the
  sum includes at least one fallback estimate.
- **AC-61.** WHILE the summed token estimate is still being computed, the
  system shall display the document listing with a pending indicator in place
  of the sum, so the listing is never blocked by the computation.
- **AC-62.** IF the listing contains no documents, THEN the system shall state
  a summed estimate of zero tokens in the status line.
- **AC-63.** IF the repository has no local clone, THEN the system shall omit
  the document count and the summed token estimate from the status line rather
  than showing zero values.

### Attachment

- **AC-7.** WHEN the user opens the `Context` tab of an agent editor, the
  system shall list every discovered document with its attachment state, its
  path prefix, and a document-type label.
- **AC-64.** The system shall set a document's type label to the first
  configured context root that the document's path matched, so a custom root
  such as `adr/` or `rfc/` yields its own label without further configuration.
- **AC-65.** The system shall render the type label of a document matched under
  `specs/`, `docs/`, or `insights/` in a colour fixed per that root.
- **AC-68.** The system shall render the type label of a document matched under
  any other configured root in one neutral colour.
- **AC-8.** WHEN the user toggles a document's checkbox in the `Context` tab of
  an agent, the system shall persist that document's repository-relative path
  as an attachment of that agent.
- **AC-9.** WHEN the user toggles a document's checkbox in the `Context` tab of
  a skill, the system shall persist that document's repository-relative path as
  an attachment of that skill.
- **AC-10.** The system shall persist an attachment as a repository-relative
  path and shall not persist the document's text.
- **AC-11.** WHEN the user reorders attached documents by drag, the system
  shall persist the new order.
- **AC-12.** IF a user attempts to attach a 21st document to a single agent or
  skill, THEN the system shall reject the attachment and state that the limit
  is 20 documents per agent or skill.
- **AC-13.** WHEN the `Context` tab is displayed, the system shall show the
  count of attached documents against the count of discovered documents.
- **AC-14.** WHEN a document is displayed on the Project Context page, the
  system shall show the number of agents to which that document is currently
  attached.
- **AC-52.** The system shall present a set of attached documents in its
  persisted order wherever that set is displayed.

### Token estimation

- **AC-15.** WHEN the system displays a token figure for a document, it shall
  compute that figure from the document's content at the time of the request,
  using the `cl100k_base` encoding.
- **AC-16.** The system shall render every displayed token figure with an
  approximation marker and an explanation stating that the figure is an
  estimate under `cl100k_base` and that the actual count depends on the
  provider.
- **AC-17.** WHEN the `Context` tab displays a set of attached documents, the
  system shall display the summed estimated token count for that set.
- **AC-18.** IF the `cl100k_base` encoder is unavailable, THEN the system shall
  fall back to a character-based estimate of one token per four characters and
  shall still render the approximation marker.
- **AC-19.** The system shall not cache a displayed token figure across
  requests, so that a figure always reflects the document content at the time
  it is shown.

### Editing (working tree only)

- **AC-20.** WHEN the user saves an edited document from the Project Context
  page, the system shall write the new text to that file in the repository's
  local clone working tree and shall not create a git commit.
- **AC-21.** WHILE a document in the clone differs from its committed content,
  the system shall display on that document an uncommitted-changes state whose
  text says the change exists only in the local clone and is lost on the next
  resync.
- **AC-22.** WHEN the user requests a repository resync or re-index and any
  markdown document under the configured context roots has uncommitted
  changes, the system shall warn the user which documents would be overwritten.
- **AC-66.** The system shall limit the warning of AC-22 to markdown documents
  under the configured context roots, and shall not report other divergence in
  the clone.
- **AC-53.** WHILE the warning of AC-22 is displayed, the system shall not
  proceed with the resync or re-index until the user confirms.
- **AC-23.** IF a write to a document fails, THEN the system shall leave the
  file's previous content in place.
- **AC-55.** IF a write to a document fails, THEN the system shall report the
  failure with its reason.

### Run-time injection

- **AC-24.** WHEN an agent run starts, the system shall read the current text
  of each document attached to that agent and of each document attached to each
  of that agent's enabled linked skills.
- **AC-25.** The system shall order the documents read for a run as the agent's
  own attachments in their persisted order, followed by the attachments
  inherited from skills in the order those skills are linked.
- **AC-26.** IF the same document path appears more than once in that ordered
  sequence, THEN the system shall include it once, at its first position, and
  shall discard the later occurrences.
- **AC-27.** WHEN documents have been read for a run, the system shall render
  them into the prompt's existing `## Project context` section with each
  document wrapped as untrusted data.
- **AC-28.** IF an agent has no attached documents and none of its enabled
  linked skills has any, THEN the system shall omit the `## Project context`
  section from the prompt entirely.
- **AC-29.** WHERE a linked skill is disabled, the system shall not read that
  skill's attached documents for the run.
- **AC-30.** The system shall inject attached documents into a run regardless
  of the agent's `repo_intel` setting.
- **AC-31.** WHEN a run is started through the MCP `run_agent_on_pr` tool, the
  system shall apply AC-24 through AC-30 identically to a run started from the
  studio.
- **AC-32.** The system shall add no model call to a run as a result of
  attaching documents.

### Limits and degradation at run time

- **AC-33.** IF a document's text exceeds 150 000 characters, THEN the system
  shall inject only the first 150 000 characters, followed by an explicit
  truncation marker inside the wrapped block.
- **AC-34.** IF the assembled `## Project context` block would exceed 40 000
  estimated tokens, THEN the system shall drop whole documents from the end of
  the ordered sequence until the block fits.
- **AC-35.** IF a document attached to an agent or skill cannot be read at run
  time, THEN the system shall skip that document, complete the run, and record
  the document as missing.
- **AC-36.** The system shall treat a read that throws and a read that returns
  empty content as the same missing-document outcome.
- **AC-37.** IF a document attached to an agent or skill cannot be found at
  configuration time, THEN the system shall mark that attachment as missing in
  the `Context` tab without removing the attachment.

### Trace and transparency

- **AC-38.** WHEN a run completes, the system shall record in the run trace the
  repository-relative path of every document injected into the prompt.
- **AC-39.** WHEN a run completes, the system shall record for each injected
  document its estimated token count as measured at run time.
- **AC-56.** WHEN a run completes, the system shall record for each attached
  document whether it was injected in full, truncated, dropped for budget, or
  missing.
- **AC-40.** WHEN a run completes, the system shall record for each injected
  document whether it was attached directly to the agent or inherited from a
  skill, naming the skill in the inherited case.
- **AC-41.** WHEN the user opens a run trace, the system shall display the
  `Project context` prompt block containing the exact text injected into that
  run, including its untrusted-data delimiters.
- **AC-42.** The system shall record each injected document path exactly once
  in the run trace, matching the deduplicated sequence of AC-26.
- **AC-43.** WHEN a run trace displays a document's token count, the system
  shall present it as the count measured for that run, which may differ from
  the estimate shown in an editor at any other time.

### Configuration

- **AC-44.** The system shall read the set of context root directories from a
  per-workspace setting whose default value is `specs/`, `docs/`, and
  `insights/`.
- **AC-45.** WHEN a user changes the context roots setting, the system shall
  apply the new roots to the next discovery request without requiring a
  restart.
- **AC-46.** IF the context roots setting is absent or fails validation, THEN
  the system shall use the default roots of AC-44.
- **AC-54.** IF the context roots setting fails validation, THEN the system
  shall record that the configured value was rejected.

## Edge cases

| Case | Handling |
|---|---|
| No documents under the configured roots | AC-5 — empty state naming the searched roots; AC-62 — the status line states a zero token sum. |
| Repository not cloned, status line | AC-63 — count and token sum are omitted, not shown as zero. |
| Token sum slower than its budget | NFR-21, AC-61 — the listing is delivered with a pending indicator; the sum never blocks it. |
| Tokenizer fell back for some documents in the sum | AC-60 — the status line says the sum includes a fallback estimate. |
| Repository never cloned | AC-6 — distinct state, not an empty list. |
| Document deleted between attachment and run | AC-35 — run completes, document recorded missing. |
| Document renamed between attachment and run | Same as deletion — the path no longer resolves. AC-35, AC-37. Path-following across renames is not attempted. |
| Real client throws, mock returns `''` | AC-36 — both are "missing". This is a recorded trap, see Verification notes. |
| Document grew between the editor estimate and the run | AC-19, AC-43 — the editor never caches; the trace figure is the run's truth. |
| Same document attached to both an agent and its skill | AC-26 — injected once, at its first position. |
| Same document attached to two of the agent's skills | AC-26 — injected once, at its first position. |
| Skill disabled after its documents were attached | AC-29 — its documents are not read. |
| Very large document (over 150 000 chars) | AC-33 — truncated with a visible marker. |
| Attachment set exceeds the block budget | AC-34 — tail documents dropped whole, recorded per AC-56. |
| Agent has no attachments at all | AC-28 — section omitted, not an empty heading. |
| Document contains `</untrusted>` | AC-49 — the occurrence is neutralised so the block cannot be closed early. |
| Document contains HTML or scripts | AC-50 — preview renders sanitised, without executing HTML. |
| Uncommitted edit destroyed by resync | AC-21, AC-22 — made visible and confirmed, not prevented. Consciously accepted; see Design review D-1. |
| Two users edit the same document concurrently | Out of scope. The product is local-first and single-operator; last write wins, and AC-21 makes the clone's divergence visible either way. |
| Attachment count at exactly 20 | AC-12 — the 21st is rejected; 20 is permitted. |
| Missing document returns later on another branch | AC-37 — the attachment was never removed, so it simply resolves again. No automatic cleanup exists. |
| Attachment changed after a past run | NFR-23 — no new version is created; the past run's document set survives only in its trace (NFR-24). |
| Document matched under a custom root such as `adr/` | AC-64, AC-65 — labelled by that root, rendered in the neutral colour. |
| Context roots configured to a path outside the repository | AC-47 — rejected as an invalid root. |

## Non-functional requirements

**Performance**

- **NFR-1.** WHEN the user opens the Project Context page on a repository
  containing at most 500 markdown documents under the configured roots, the
  system shall return the document listing within 1 500 ms at p95, measured
  server-side from request receipt to response.
- **NFR-2.** WHEN the system computes token estimates for an attachment set of
  at most 20 documents totalling at most 2 MB, it shall return them within
  2 000 ms at p95.
- **NFR-20.** WHEN the system computes the summed token estimate of AC-57 over
  at most 500 documents totalling at most 20 MB, it shall return that sum
  within 3 000 ms at p95, measured server-side from request receipt to
  response.
- **NFR-21.** IF the summed token estimate of AC-57 cannot be produced within
  3 000 ms, THEN the system shall deliver the document listing without waiting
  for the sum.
- **NFR-22.** IF the discovered documents exceed the bounds of NFR-20, THEN the
  system shall state in the status line that the summed estimate covers only
  the documents included in the listing.

**Scale limits**

- **NFR-3.** The system shall support at most 20 attached documents per agent
  and per skill.
- **NFR-4.** The system shall inject at most 40 000 estimated tokens of project
  context per run, and at most 150 000 characters from any one document.
- **NFR-5.** WHEN discovery encounters more than 1 000 matching documents, the
  system shall return the first 1 000 by walk order.
- **NFR-19.** WHILE a document listing has been truncated per NFR-5, the system
  shall state in the status line that the listing was truncated.

**Degradation**

- **NFR-6.** IF the document reader fails entirely at run time, THEN the system
  shall complete the run with the `## Project context` section omitted and
  shall record the reader failure in the run trace.
- **NFR-7.** IF the clone is unavailable while the Project Context page is
  open, THEN the system shall report that the repository content could not be
  read, and shall not present an empty list as a successful result.

**Determinism**

- **NFR-8.** WHEN the same documents with the same content are attached in the
  same order, the system shall produce a byte-identical `## Project context`
  block.
- **NFR-9.** The system shall derive every value it shows about a document —
  path, size, token estimate, attachment count — from file content and stored
  attachments, with no model-generated value among them.
- **NFR-23.** WHEN an attachment is added, removed, or reordered, the system
  shall apply the change without creating a new agent or skill version.
- **NFR-24.** WHEN a run completes, the system shall record in that run's trace
  the document set the run actually used, so the run remains auditable even
  though the attachment set that produced it is not versioned.

**Reproducibility trade-off (user decision).** NFR-23 is a deliberate
simplification chosen over versioning attachments. Its cost is real and is
recorded here rather than discovered later: because an attachment change does
not bump a version, `agent_versions` will report that an agent's configuration
is unchanged while the prompt that agent produces has in fact changed, and a
past run therefore cannot be replayed with the document set it originally used.
What survives is the run's own history — NFR-24 and AC-38 through AC-40 pin
every document, its size, and its origin into the trace of the run that read
it. Auditability is preserved; configuration reproducibility is knowingly
given up. NFR-8 remains accurate as written: it constrains the rendering of a
given attachment set, not the recoverability of a past one.

**Observability**

- **NFR-10.** WHEN a run reads project context, the system shall log the count
  of documents read, the count skipped as missing, the count truncated, and the
  count dropped for budget, in the run's event log.
- **NFR-11.** WHEN a document write is performed, the system shall log the
  document path and the outcome of the write.

**Accessibility**

- **NFR-12.** The system shall make every attachment checkbox, filter field,
  and preview control on the `Context` tab reachable and operable by keyboard
  alone.
- **NFR-13.** WHERE documents are reorderable by drag, the system shall provide
  a keyboard-operable means of changing the order that achieves the same result
  as dragging.
- **NFR-14.** WHILE a document listing or preview is loading, the system shall
  expose a status message naming what is loading.
- **NFR-15.** WHEN a document's uncommitted-changes state is displayed, the
  system shall convey that state by text and not by colour alone.

**Security and privacy**

- **NFR-16.** The system shall never write document text into the attachment
  record, so that document content is stored only in the repository.
- **NFR-17.** The system shall never log the full text of a project-context
  document; logs shall carry paths, sizes, and counts only.
- **NFR-18.** The system shall resolve every document path within the target
  repository's clone directory and shall reject any path that escapes it.

## Inputs and provenance

| Input | Source | Owner | Determinism | Shown as |
|---|---|---|---|---|
| Document list | Filesystem walk of the repository clone under the configured roots | The repository | Deterministic | Paths, exactly as on disk |
| Document text | The file in the clone working tree | The repository (or a local uncommitted edit) | Deterministic | Rendered markdown, sanitised |
| Uncommitted-changes flag | Comparison of working-tree content against committed content | git | Deterministic | Explicit textual state (AC-21) |
| Token estimate (per document, per set, and summed over the listing) | `cl100k_base` encoding of the document text, or the 4-chars-per-token fallback | DevDigest | Deterministic, but **approximate for any given provider** | Always with an approximation marker and explanation (AC-16, AC-59); a sum containing a fallback says so (AC-60) |
| Attachment set and order | User's explicit choices, persisted | The user | Deterministic | The list, in its persisted order |
| `Used by N agents` | Count of stored attachments referencing the document | DevDigest | Deterministic | A count |
| `specs_read` in a trace | What the run actually read | DevDigest | Deterministic | Paths with per-document status (AC-38…AC-40) |

No value in this feature is model-generated. The one figure that is inherently
inexact is the token estimate: the encoding used is OpenAI's, while agents may
run on Anthropic or OpenRouter models whose tokenizers differ. AC-16 requires
that inexactness to be stated wherever the number appears, rather than
presented as a hard count.

## Untrusted inputs

Every project-context document is untrusted. A document is a file in the
repository under review; on a pull request from an untrusted contributor, its
content is attacker-controlled and reaches both the model and the reviewer's
browser.

- **AC-47.** The system shall reject any configured context root or requested
  document path that is absolute, contains a parent-directory segment, or
  resolves outside the target repository's clone directory.
- **AC-48.** WHEN a document is injected into a prompt, the system shall wrap
  it in the untrusted-data delimiters and shall rely on the single shared
  injection guard, adding no keyword scanning of document text.
- **AC-49.** WHEN a document's text contains the untrusted-block closing
  delimiter, the system shall neutralise that occurrence so the document cannot
  terminate its own block.
- **AC-50.** WHEN a document is previewed in the studio, the system shall
  render it without executing embedded HTML or scripts, and shall not activate
  links carrying a non-`http(s)` scheme.
- **AC-51.** The system shall apply the untrusted treatment of AC-48 to every
  document regardless of which root it came from, so no directory is privileged
  as trusted.

The trust policy belongs to the run executor, not to the prompt renderer —
matching how linked skills and derived intent are already handled, where the
renderer applies no trust policy of its own.

## Design review

The design was supplied as a **written description of four mockups**, not as
the mockup images. I reviewed the description against the code; I did not see
the originals, so any visual detail not captured in the description is
unreviewed.

- **D-1 — `Edit` mode writes into a cache (mockup 1).** The clone is a
  read-only mirror: `sync()` performs `git reset --hard origin/<branch>`, and
  its own comment justifies that as "safe here because we never commit to or
  run code from the clone". Editing files there breaks that assumption, and a
  resync destroys the edit with no trace. My recommendation was to drop `Edit`.
  **The user chose to keep it, saving without a commit.** Resolved as accepted
  risk, made visible rather than removed: AC-20 (write, no commit), AC-21
  (persistent uncommitted state), AC-22 (resync warns and requires
  confirmation). Committing and pushing are Non-goals. The data-loss risk
  remains real; the requirement is that the user is never surprised by it.
- **D-2 — `.devdigest/specs/` path (mockup 1) contradicts the requirement.**
  The mockup's subtitle names a folder outside the repository, while the
  requirement specifies repository directories. `.devdigest/` currently holds
  only the clone workspace and secrets, and no code references a specs folder
  there. Resolved: documents come from the repository (AC-1, AC-44); the mockup
  subtitle is stale and should render the configured roots instead.
- **D-3 — `Indexed: 12 files · 1,240 chunks` (mockup 1) describes machinery
  that does not exist.** The repo index covers source code, not markdown, and
  counts files, not chunks. Chunking remains a Non-goal. Resolved: the status
  line reports the number of documents found, a **summed token estimate**, and
  the scan time (AC-3, AC-57, AC-58). The token sum is the better replacement
  because the chunk counter described machinery that does not exist, while the
  sum answers the question a user actually has before attaching anything —
  what this material will cost in a prompt. That makes the status line part of
  the same cost-estimation mechanism as the `≈ N tokens` badge in the agent and
  skill editors, computed the same way (AC-59) rather than by a second method.
- **D-4 — `78 COVERAGE` ring (mockup 1) has no definition.** Nothing in the
  design or requirements says what is covered by what. Rendering a number
  without a definition is exactly the provenance defect this review is meant to
  catch. Resolved: removed to Non-goals. `Used by 3 agents` is kept because it
  is a countable fact (AC-14).
- **D-5 — Token badge `≈ 317 tokens` (mockup 2) is honest but under-specified.**
  The available encoder is `cl100k_base`, while agents run on three provider
  families. Resolved: keep the approximation marker and require an explicit
  explanation of the encoding and its limits (AC-15, AC-16).
- **D-6 — "Order matters — earlier docs appear earlier" (mockup 2) implies an
  outcome it cannot promise.** Order deterministically changes the prompt; that
  it changes review quality is unverified. Resolved: order is persisted and
  deterministic (AC-11, AC-25), and the caption should state the effect on the
  assembled block only, without implying a quality effect.
- **D-7 — Skill inheritance (mockup 3) creates a duplication case the design
  does not address.** "Any agent using this skill inherits these documents"
  plus per-agent attachment means one document can arrive twice. Resolved:
  AC-25, AC-26, AC-42 — deduplicated at first position, and the trace labels
  origin (AC-40).
- **D-8 — Neither mockup shows a missing document.** An attachment is a path,
  and paths rot. Resolved: AC-37 marks it in the editor, AC-35 keeps the run
  alive.
- **D-9 — Neither mockup shows the empty, first-run, or not-cloned states.**
  Mockup 1 assumes a populated repository. Resolved: AC-5, AC-6, NFR-7.
- **D-10 — `SERIALIZES AS` preview (mockup 3) shows a heading that does not
  match the prompt.** It renders `## Project specifications`, while the
  assembled prompt uses `## Project context`, and it lists paths where the
  prompt carries wrapped full text. Resolved: the preview must name the real
  section and show the untrusted wrapping, so it does not teach the user a
  false picture of the prompt.
- **D-11 — Tabs shown on mockups 2 and 3 do not exist.** The agent editor has
  `config` and `skills` only; the skill detail pane's `evals` and `stats` are
  already marked in code as rendered-but-unimplemented. Resolved: this feature
  adds only the `Context` tab to each; `Evals`, `Stats`, `CI` are Non-goals.
- **D-12 — Mockup 1's toolbar offers create, new-folder, and upload.** These
  are write operations against the repository beyond editing an existing file.
  Resolved: Non-goals.
- **D-13 — Proposal: the trace's `Specs read` row should carry per-document
  status.** Mockup 4 shows bare paths. A path that was truncated, dropped for
  budget, or missing looks identical to one fully injected, which makes the
  trace misleading precisely when something went wrong. Proposed and resolved
  as AC-39, AC-40, AC-56.
- **D-14 — Proposal: the drag-order list needs a keyboard equivalent.** Mockup
  2's ordering is drag-only. Proposed and resolved as NFR-13.
- **D-15 — Mockup 1 places Project Context under `WORKSPACE` while its
  breadcrumb is repository-scoped.** Read quickly, the two disagree about
  scope. Resolved as consistent rather than as a defect: the page is scoped to
  a single repository (AC-67), because documents are read from that
  repository's clone, and the breadcrumb `acme/payments-api > Project Context`
  is correct. The `WORKSPACE` grouping describes where the entry sits in
  navigation, alongside Pull Requests, which is likewise repository-scoped in
  use. No change to the navigation is required.

## Module interactions

- **Document discovery and reading (server).** A new capability that walks the
  clone under the configured roots and reads document text. It consumes the
  existing `GitClient` port for file reads; that port exposes `readFile` but no
  directory listing, so listing markdown files under the roots is a capability
  the server must gain. Path containment (AC-47) is enforced before any
  filesystem access, following the existing spec-path guard used by intent
  derivation.
- **Attachments (server).** Agents and skills each gain a persisted, ordered
  set of document paths, held in their own link tables with the existing
  `agent_skills` semantics, including its `order` column. **Attachments are
  deliberately not part of the versioned configuration** of either an agent or
  a skill: `agent_versions` does not snapshot them and `AgentVersionConfig` is
  unchanged, so this feature does not force a change to the twice-vendored
  contract. The trade-off this buys, and its cost, is stated as NFR-23 and
  NFR-24 — a user decision, recorded rather than hidden.
- **Run executor (server) → `reviewer-core`.** The executor reads documents,
  applies order, deduplication, truncation, and budget, wraps each document as
  untrusted, and passes them into the existing `specs` slot. `reviewer-core`
  renders them and applies no trust policy of its own — the same division
  already documented for linked skills and derived intent. The
  `## Project context` section name is unchanged, so already-persisted traces
  remain readable.
- **Tokenizer port.** Token estimation is required by both the studio
  (AC-15…AC-17) and the run-time budget (AC-34). The existing tokenizer is
  scoped in its own documentation to `modules/repo-intel`, and the dependency
  from `repo-intel/service.ts` to it is already a tracked architectural
  warning. A consequence of this feature is therefore that token counting must
  become a capability available outside `repo-intel` without adding a new
  architectural violation. How that is achieved belongs to the plan; that it
  must not add a violation is a requirement here.
- **Repo-intel resync.** `sync()` is called from the indexer, reachable from
  the studio's resync and re-index actions. AC-22 requires that path to check
  for uncommitted document edits and warn first — a behavioural change to an
  existing flow, not only an addition.
- **Settings.** Context roots become a per-workspace setting with fail-safe
  parsing, following the pattern already used for the intent link allowlist,
  where an invalid stored value degrades to the default rather than failing the
  request (AC-46).
- **Shared contract (two-sided).** `RunTrace.specs_read` is currently
  `z.array(z.string())`. Carrying per-document token counts, origin, and status
  (AC-39, AC-40, AC-56) changes that element's shape. `@devdigest/shared` is vendored
  twice — `server/src/vendor/shared/` and `client/src/vendor/shared/` — with no
  sync script, so this is a two-file edit; a one-sided edit type-checks and
  silently desynchronises the API. The new shape must also parse traces
  persisted under the old shape, which are plain strings.
- **Client.** The Project Context page is new. The agent editor and the skill
  detail pane each gain a `Context` tab. The run-trace drawer already renders
  the `Specs read` row and the `Project context` prompt block; both need to
  present the richer per-document status rather than bare strings. A message
  namespace named `context` already exists and is currently referenced by no
  component; its keys describe this page, including a `preview`/`edit` pair.
- **MCP.** `run_agent_on_pr` reaches the same executor, so AC-31 follows from
  placing the logic in the executor rather than in an HTTP route.

## Traceability

| ID | Serves | Source | Verified by |
|---|---|---|---|
| AC-1 | US-1 | requirement: reader over `specs`/`docs`/`insights` | integration test |
| AC-2 | US-1 | code: indexer excluded-directory set | unit test |
| AC-3 | US-1 | design finding D-3 | unit test |
| AC-57 | US-1, US-5 | user decision: token sum replaces chunks; design finding D-3 | integration test |
| AC-58 | US-1 | design finding D-3 | unit test |
| AC-59 | US-5 | user decision: one counting method only | unit test |
| AC-60 | US-5 | code: tokenizer fallback behaviour | unit test |
| AC-61 | US-1 | NFR-20 budget; client loader convention | unit test |
| AC-62 | US-1 | design finding D-9 | unit test |
| AC-63 | US-1 | design finding D-9 | unit test |
| AC-64 | US-3 | user decision: label from the matched root | unit test |
| AC-65 | US-3 | mockup 2 type badges; user decision | unit test |
| AC-68 | US-3 | user decision: neutral colour for custom roots | unit test |
| AC-66 | US-8 | user decision: warning scoped to editable documents | integration test |
| AC-67 | US-1 | user decision: one repository per page; design finding D-15 | unit test |
| AC-4 | US-2 | mockup 1 preview pane | unit test |
| AC-5 | US-1 | design finding D-9 | unit test |
| AC-6 | US-1 | design finding D-9 | unit test |
| AC-7 | US-3 | mockup 2 | unit test |
| AC-8 | US-3 | requirement: manual attachment | integration test |
| AC-9 | US-4 | mockup 3 | integration test |
| AC-10 | US-3, US-4 | requirement: store paths, not text | integration test |
| AC-11 | US-3 | mockup 2 drag order; design finding D-6 | integration test |
| AC-12 | US-3, NFR-3 | user decision: 20 per entity | integration test |
| AC-13 | US-3 | mockup 2 badge `2 of 7 attached` | unit test |
| AC-14 | US-1 | mockup 1 `Used by 3 agents`; design finding D-4 | integration test |
| AC-15 | US-5 | user decision: `cl100k_base` | unit test |
| AC-16 | US-5 | design finding D-5 | unit test |
| AC-17 | US-5 | mockup 2 footer `≈ 317 tokens` | unit test |
| AC-18 | US-5 | code: tokenizer fallback behaviour | unit test |
| AC-19 | US-5 | user decision: no cached estimate | unit test |
| AC-20 | US-8 | user decision: save without commit | integration test |
| AC-21 | US-8 | user decision; design finding D-1 | integration test |
| AC-22 | US-8 | design finding D-1; code: `sync()` is `reset --hard` | integration test |
| AC-23 | US-8 | design finding D-1 | integration test |
| AC-24 | US-3, US-4 | requirement: docs added as text at run start | integration test |
| AC-25 | US-3, US-4 | user decision: agent order, then skills | integration test |
| AC-26 | US-3, US-4 | design finding D-7 | integration test |
| AC-27 | US-3 | requirement: `## Project context`, untrusted | integration test |
| AC-28 | US-3 | code: empty prompt slots omit their section | unit test |
| AC-29 | US-4 | user decision: disabled skill contributes nothing | integration test |
| AC-30 | US-3 | user decision: independent of `repo_intel` | integration test |
| AC-31 | US-3 | user decision: MCP parity | integration test |
| AC-32 | Goals §4 | requirement: no extra LLM call | integration test |
| AC-33 | US-3, NFR-4 | user decision: 150 000 chars per document | unit test |
| AC-34 | US-3, NFR-4 | user decision: 40 000 tokens per block | unit test |
| AC-35 | US-6 | user decision: skip, never fail the run | integration test |
| AC-36 | US-6 | INSIGHTS: `readFile` throws vs returns `''` | integration test |
| AC-37 | US-3 | design finding D-8 | unit test |
| AC-38 | US-6 | requirement: trace shows `specs_read` | integration test |
| AC-39 | US-6 | design finding D-13 | integration test |
| AC-40 | US-6 | design findings D-7, D-13 | integration test |
| AC-41 | US-6 | requirement: open and read full injected text | integration test |
| AC-42 | US-6 | design finding D-7 | integration test |
| AC-43 | US-5, US-6 | user decision: trace figure is the run's truth | integration test |
| AC-44 | US-7 | user decision: per-workspace setting | integration test |
| AC-45 | US-7 | user decision: no restart required | integration test |
| AC-46 | US-7 | code: intent-allowlist fail-safe parsing precedent | unit test |
| AC-47 | Untrusted inputs | code: existing path-traversal guard | unit test |
| AC-48 | Untrusted inputs | code: single shared injection guard | integration test |
| AC-49 | Untrusted inputs | code: delimiter escaping in `wrapUntrusted` | unit test |
| AC-50 | Untrusted inputs | design review, mockup 1 preview | unit test |
| AC-51 | Untrusted inputs | design review | unit test |
| AC-52 | US-3 | mockup 2 drag order; design finding D-6 | unit test |
| AC-53 | US-8 | design finding D-1; code: `sync()` is `reset --hard` | integration test |
| AC-54 | US-7 | code: intent-allowlist fail-safe parsing precedent | unit test |
| AC-55 | US-8 | design finding D-1 | integration test |
| AC-56 | US-6 | design finding D-13 | integration test |
| NFR-1 | Goals §1 | performance budget for the listing | manual review |
| NFR-2 | Goals §3 | performance budget for estimation | manual review |
| NFR-3 | Goals §2 | user decision: 20 per entity | integration test |
| NFR-4 | Goals §4 | user decision: truncation and block budget | unit test |
| NFR-5 | Goals §1 | code: indexer bounding precedent | unit test |
| NFR-6 | Goals §4 | code: enrichment never fails a run | integration test |
| NFR-7 | Goals §1 | design finding D-9 | unit test |
| NFR-8 | Goals §5 | determinism of the assembled block | unit test |
| NFR-9 | Goals §5 | provenance review | manual review |
| NFR-10 | Goals §5 | requirement: trace shows document volume | integration test |
| NFR-11 | US-8 | design finding D-1 | integration test |
| NFR-12 | US-3 | accessibility review | unit test |
| NFR-13 | US-3 | design finding D-14 | unit test |
| NFR-14 | US-1 | client loader convention | unit test |
| NFR-15 | US-8 | accessibility review | unit test |
| NFR-16 | Goals §2 | requirement: store paths, not text | integration test |
| NFR-17 | Untrusted inputs | privacy review | manual review |
| NFR-18 | Untrusted inputs | code: path containment | unit test |
| NFR-19 | Goals §1 | code: indexer bounding precedent | unit test |
| NFR-20 | Goals §3 | performance budget for the summed estimate | manual review |
| NFR-21 | Goals §1 | design finding D-3; listing must not block | integration test |
| NFR-22 | Goals §1 | code: indexer bounding precedent | unit test |
| NFR-23 | Goals §2 | user decision: simpler implementation, no versioning | integration test |
| NFR-24 | Goals §5 | user decision: trace preserves what versioning does not | integration test |

## Verification notes

**The end-to-end check that decides whether this feature works.** Attach a
document stating an invariant such as "module `api/` must not import `db/`
directly", open a pull request that violates it, run the agent, and confirm the
review produces a finding that cites that document. This is the only check that
proves the feature changed reviewer behaviour rather than merely moving text
around; everything else verifies mechanism. It needs a database, a repository
fixture, and a stubbed model, so it belongs in the integration lane.

**Traps that will make verification lie:**

- **`readFile` fails in two different shapes.** `SimpleGitClient.readFile` is a
  bare filesystem read and rejects on a missing file; `MockGitClient.readFile`
  returns `''` for any path absent from its fixture map. A test for AC-35 built
  only on the mock will pass while the real client throws and fails the run.
  AC-36 exists precisely because both shapes must be treated as missing, and
  any test of it must exercise both — a throwing read and an empty read.
- **`arch:check` exits 0 while reporting violations.** The tokenizer change
  described in Module interactions is exactly the kind that adds a dependency
  warning. Judge it by the summary line `x N dependency violations (E errors,
  W warnings)` against the recorded baseline of 6 warnings and 0 errors, never
  by the exit code.
- **Piping a check into `tail` or `head` discards its exit code.** Relevant to
  every verification command run here.
- **`server` typecheck has 2 pre-existing errors** (`db/migrate.ts:38`,
  `db/seed.ts:499`). A green run is impossible; compare against the baseline.
- **The vendored shared contract is duplicated.** A one-sided edit to
  `RunTrace` type-checks in its own package and desynchronises the API
  silently. Verification must compare the two vendored copies directly, not
  rely on either package compiling.
- **Old traces must still parse.** `specs_read` currently holds plain strings.
  Any richer shape must be verified against a trace persisted in the old form,
  or the run-trace drawer breaks for historical runs — the same nullish-field
  reasoning already applied to `RunStats.cost_usd`.
- **`user-event` is not installed in the client.** Client interaction tests use
  `fireEvent`; importing `@testing-library/user-event` fails at collection time
  with an error naming the test file, not the missing package.
- **Both test lanes running at once fail under contention.** Run the hermetic
  and integration lanes separately.
- **A test that replays a past run will not reproduce its project context.**
  Attachments are not versioned (NFR-23), so a fixture that changes an
  attachment and re-runs an agent gets the new document set while
  `agent_versions` still reports the old configuration as current. Verify the
  document set of a past run from that run's trace (NFR-24), never by reading
  the agent's current attachments or its version snapshot.
- **The summed token estimate tokenizes every discovered document, not just
  the attached ones.** A fixture of a handful of small documents will meet
  NFR-20 trivially and prove nothing about a real repository. Any check of that
  budget needs a fixture at the stated bound, and the encoder's lazy
  initialisation means the first call in a process is materially slower than
  the rest — a benchmark that measures only a warm encoder will understate the
  cost of opening the page.

**What needs which kind of check:**

- Hermetic unit tests: the status line's composition and its empty, no-clone,
  pending, and fallback states (AC-3, AC-57 through AC-63); path containment
  (AC-47), delimiter escaping (AC-49),
  ordering and deduplication (AC-25, AC-26), truncation and budget (AC-33,
  AC-34), token estimation and its fallback (AC-15, AC-18), settings fail-safe
  parsing (AC-46), and the client's rendering of tabs, badges, states, and
  sanitised preview.
- Database-backed integration tests (`*.it.test.ts`): attachment persistence
  and ordering, inheritance from skills, the assembled prompt and its trace
  (AC-24 through AC-43), and MCP parity (AC-31). The existing
  `skills-in-prompt.it.test.ts` is the closest precedent for asserting on an
  assembled prompt.
- Browser flow: the attach-then-run-then-read-the-trace path (US-3, US-6).
- Manual review: the performance budgets (NFR-1, NFR-2), which have no
  automated harness here, and the provenance and privacy claims (NFR-9,
  NFR-17).
- **Awkward to verify, flagged deliberately:** AC-22 (resync warning) crosses
  the UI and the indexer and has no current test seam; NFR-1 and NFR-2 depend
  on a repository fixture of realistic size that does not exist yet. Both are
  candidates for tightening once a harness exists.

## Open questions

None. The five questions raised during drafting were settled by the user and
are recorded where they take effect: attachment versioning as NFR-23, NFR-24
and the reproducibility trade-off note; the document-type label as AC-64 and
AC-65; the scope of the resync warning as AC-22 and AC-66; the absence of any
automatic cleanup of missing attachments as AC-37; and the page's
single-repository scope as AC-67 and design finding D-15.
