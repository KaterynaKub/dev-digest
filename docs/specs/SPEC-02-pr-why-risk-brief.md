# Spec: PR Why + Risk Brief

Spec ID: SPEC-02
Status: approved

## Problem and user

A reviewer opening a pull request in the studio today gets four separate
answers and no synthesis. `IntentCard` shows what the author says the PR is
for. `BlastRadiusCard` shows which callers, endpoints, and crons the changed
symbols reach. The Files-changed tab shows a reviewer-ordered diff. A finished
review shows findings. Nothing tells the reviewer, before they start reading,
**what this PR changes, why, how dangerous it is, and which lines to open
first**.

Three roles are blocked:

- **The PR reviewer** must reconstruct the picture by reading three cards and
  the whole diff. The two existing cards are deliberately narrow — `IntentCard`
  renders only the author's stated scope and never names a file, and
  `BlastRadiusCard` names files but says nothing about whether reaching them is
  risky. Neither answers "where do I start".
- **The reviewer working under time pressure** has no ordered entry point. The
  Files-changed tab groups by role (core / wiring / boilerplate), which is an
  ordering of the *whole* diff, not a shortlist of what matters.
- **The repository owner paying for model calls** has no cheap way to get that
  synthesis. A full review reads every hunk; a reviewer who only wants to know
  whether a PR is worth opening should not have to pay for one.

The material for the synthesis already exists and is already paid for: a
derived intent persisted per head sha (`pr_intent`), a blast radius computed
from the `repo-intel` index, diff stats in `pr_files`, a linked issue
resolvable from the PR body, and the repository's own markdown documents
discoverable through Project Context. Nothing composes them.

Three pieces of dormant plumbing exist and are inert. The `pr_brief` table
(`pr_id`, `json`) has existed since `0000_init.sql` and is never read or
written. The `PrBrief` contract in `contracts/brief.ts` is exported and
consumed by no server or client code. A `risk_brief` entry sits in
`FEATURE_MODELS`, selectable in Settings, wired to nothing. The `brief` message
namespace exists in `client/messages/en/brief.json` and no component calls
`useTranslations("brief")`.

## Goals / Non-goals

**Goals**

1. Produce, on demand and for one pull request, a short brief stating what the
   PR changes, why, and a single risk level, from metadata alone.
2. Name concrete risks, each pointing at a real file or endpoint the input
   data already contains.
3. Give the reviewer an ordered "read these first" list whose every entry
   navigates to a real `file:line` in the studio or on GitHub.
4. Reject every reference the model invents, visibly, so a brief never sends a
   reviewer to a path that does not exist.
5. Select the repository documents relevant to *this* PR automatically and
   deterministically, so the brief is grounded in the project's own written
   rules without the user attaching anything.
6. Cache the brief against the exact state it describes, and let the user
   force a regeneration.
7. Make the cost of the brief visible: the model call's tokens and price, and
   the fact that the model never saw a line of diff content.

**Non-goals**

- **A PR score, a verdict, or findings counts.** Mockup 1's `PR SCORE 61`
  ring, its `Request changes` verdict, and its `6 findings · 2 blockers` badge
  are the **existing** `VerdictBanner`, rendered from a completed review's data
  inside `ReviewRunAccordion`. Unlike SPEC-01's `COVERAGE` ring, these have a
  real source — but that source is the review, not the brief. The brief's model
  never sees findings, so it cannot produce them. `risk_level` is a separate,
  differently-derived value (see Inputs and provenance) and the design must not
  let the two read as one number.
- **Reading diff hunk bodies.** The model receives paths, counts, and hunk
  headers only. This is a cost and privacy limit, not an oversight (NFR-4).
- **`Prior PRs touching these files`** (mockup 1, blast panel). Nothing in the
  codebase computes it; the `PrHistory` contract that would carry it is
  dormant and has no producer. Excluded rather than rendered as a placeholder.
- **Changing `IntentCard` or `BlastRadiusCard`.** Both already exist and are
  rendered side by side in `OverviewTab`. Mockup 1's `RISK AREAS` rows inside
  the intent panel are the brief's `risks[]` and belong to the new card, not to
  `IntentCard`. The `Tree/Graph` toggle, the caller tree, and the endpoint and
  cron badges are existing blast behaviour and are untouched.
- **The Files changed tab** (mockup 2). Review focus navigates *into* it; it is
  not modified by this feature.
- **Making the brief an input to a review run.** The brief is a reading aid for
  a human. No agent prompt gains a `## PR brief` section.
- **Automatic relevance selection for agent and skill attachments.** The
  selection introduced here (AC-11…AC-19) serves the brief's own input only.
  Attaching documents to an agent or a skill stays manual, exactly as SPEC-01
  specifies, and no review run's `## Project context` block changes.
- **Semantic or embedding-based selection.** The `code_chunks` table carries an
  `embedding` column and a `source: 'code' | 'docs' | 'spec'` discriminator,
  and is referenced by no code at all. Selection here is lexical and
  deterministic (AC-12). Embedding-based selection is a later decision.
- **A per-line explanation of the diff.** `SmartDiff`'s `pseudocode_summary`
  already owns per-file "what this does".

### Relationship to SPEC-01

SPEC-01 (Project Context Folder, `approved`) lists **"Automatic relevance
selection. Choosing documents by PR content is a separate feature. Selection
here is manual only."** among its Non-goals.

This spec introduces that selection, **scoped strictly to the brief's own
input**. SPEC-01 is not superseded and is not edited: its subject — browsing,
reading, editing, and manually attaching documents to agents and skills, and
injecting them into a review run's `## Project context` block — is unchanged in
every respect, and manual attachment remains the only mechanism that affects a
review run. What this spec adds is a second, independent consumer of the same
discovered document set, which picks its own documents for one brief and stores
that choice nowhere except the brief it produced.

Read the two together as: SPEC-01 owns the documents and how a *run* gets them;
SPEC-02 owns how a *brief* gets them.

## User stories

- **US-1.** As a PR reviewer, I want a short statement of what this PR changes
  and why, so that I can decide whether to open it now without reading the
  diff.
- **US-2.** As a PR reviewer, I want one risk level for the PR, so that I can
  triage a queue of pull requests.
- **US-3.** As a PR reviewer, I want the named risks to point at real files, so
  that I can check each claim instead of taking it on trust.
- **US-4.** As a PR reviewer, I want an ordered list of places to read first,
  each of which opens the code, so that I start where it matters instead of at
  the top of the diff.
- **US-5.** As a PR reviewer, I want the brief to be grounded in the project's
  own written rules without me attaching anything, so that it can say "this
  contradicts the documented invariant" on a repository I have not configured.
- **US-6.** As a repository owner, I want the brief cached against the state it
  describes and regenerable on demand, so that reopening a PR costs nothing and
  a stale brief is never presented as current.
- **US-7.** As a repository owner, I want to see what the brief cost and what
  the model was given, so that I can judge the spend and confirm no source code
  left the machine.
- **US-8.** As a PR reviewer, I want to be told plainly when the brief was
  built without part of its input, so that I do not read a thin brief as a
  clean bill of health.

## Acceptance criteria (EARS)

### Generating a brief

- **AC-1.** WHEN the user requests a brief for a pull request, the system shall
  produce a brief containing a statement of what the PR changes, a statement of
  why, one risk level, a list of risks, and an ordered review-focus list.
- **AC-2.** The system shall assemble the model's input from the derived PR
  intent, the blast radius, the PR's diff statistics, the linked issue, and the
  selected repository documents, and from no other source.
- **AC-3.** The system shall include in that input, for each changed file, the
  file path, its addition and deletion counts, and its hunk headers, and shall
  include no line content from any hunk.
- **AC-4.** The system shall obtain the brief from exactly one structured model
  call per generation.
- **AC-5.** The system shall set the brief's risk level to one of exactly three
  values: `high`, `medium`, `low`.
- **AC-6.** The system shall order the review-focus list as the model returned
  it, so the first surviving entry is the one the brief presents as most
  important.
- **AC-7.** WHEN a brief is produced, the system shall record the model's input
  tokens, output tokens, cost, and cost source alongside the brief.
- **AC-8.** WHEN a brief is displayed, the system shall show its cost and its
  input and output token counts.
- **AC-9.** IF the recorded cost is `0`, THEN the system shall display it as a
  price of zero and not as an unknown cost.
- **AC-10.** IF no cost is recorded, THEN the system shall display the cost as
  unknown and distinguish that state from a cost of zero.

### Selecting the project documents (introduced by this spec — see Relationship to SPEC-01)

- **AC-11.** WHEN the system assembles a brief's input, it shall select the
  repository documents to include automatically, without requiring the user to
  attach any document to anything.
- **AC-12.** The system shall select documents by lexical overlap between each
  document's repository-relative path and the repository-relative paths of the
  PR's changed files, using no model call and no embedding.
- **AC-13.** The system shall consider as candidates exactly the documents that
  Project Context discovers for that repository — the same configured context
  roots, the same file extension, and the same excluded-directory set — and no
  document outside them.
- **AC-14.** The system shall rank the candidates by their overlap score
  descending, breaking every tie by repository-relative path ascending, so the
  ranking is a total order.
- **AC-15.** The system shall include at most 5 selected documents in one
  brief's input.
- **AC-16.** The system shall include at most 4 000 estimated tokens of
  selected document text in one brief's input, dropping whole documents from
  the tail of the ranking rather than truncating the ranking's head.
- **AC-17.** IF no candidate document scores above zero overlap, THEN the
  system shall include no documents and shall record that the brief was built
  without project documents.
- **AC-18.** WHEN a brief is produced, the system shall record with it the
  repository-relative path and the rank of every document that was selected,
  and every document that was dropped for the limits of AC-15 or AC-16 together
  with which limit dropped it.
- **AC-19.** WHEN a brief is displayed, the system shall make the selected
  document paths readable by the user.
- **AC-60.** The system shall score a candidate document by the number of
  repository-relative path segments it shares with any changed file path,
  ignoring file extensions, and shall score a document that shares no segment
  as zero.
- **AC-61.** The system shall rank candidate documents from their paths alone
  and shall not read a candidate document's content in order to score or rank
  it.

### Rejecting invented references

- **AC-20.** The system shall accept a risk or a review-focus entry only when
  every file it references is a path present in the brief's own input data.
- **AC-21.** The system shall accept a risk or a review-focus entry only when
  every endpoint it references is an endpoint present in the brief's own input
  data.
- **AC-22.** IF a risk or a review-focus entry references a file or an endpoint
  absent from the input data, THEN the system shall drop that whole entry and
  shall not present it to the user.
- **AC-23.** WHEN the system drops an entry under AC-22, it shall record the
  dropped entry and the reason it was dropped.
- **AC-24.** WHEN a brief is displayed and any entry was dropped under AC-22,
  the system shall state that at least one entry was rejected and make the
  recorded reasons readable.
- **AC-25.** IF a review-focus entry names a line number that is not covered by
  any hunk of the file it names, THEN the system shall keep the entry and
  present it without a line number, rather than dropping it or linking to an
  unverified line.
- **AC-26.** IF every risk and every review-focus entry is dropped under AC-22,
  THEN the system shall present the brief's what, why, and risk level with an
  explicit statement that no reference survived validation.

### Cache and regeneration

- **AC-27.** The system shall key a stored brief by the pull request, the PR's
  head sha, and the `indexed_sha` of the blast radius the brief was built from.
- **AC-28.** The system shall treat an absent `indexed_sha` as a distinct key
  value, so a brief built with no index is never served for a state that has
  one.
- **AC-29.** WHEN the user opens a pull request whose stored brief matches the
  current head sha and the current `indexed_sha`, the system shall present that
  stored brief and shall make no model call.
- **AC-30.** WHEN the user opens a pull request whose stored brief does not
  match on both keys, the system shall not present the stored brief as current.
- **AC-31.** WHEN the user activates the regeneration control, the system shall
  produce a new brief and replace the stored one, regardless of whether the key
  matches.
- **AC-32.** WHILE a brief is being generated, the system shall show that
  generation is in progress.
- **AC-58.** WHILE a brief is being generated for a pull request, the system
  shall reject a second generation request for that same pull request.
- **AC-33.** IF the pull request's head sha changes while a generation is in
  flight, THEN the system shall store the produced brief against the head sha
  its input was assembled from, and shall not present it as describing the new
  head.
- **AC-34.** WHEN a brief is displayed, the system shall show the head sha it
  describes and the time it was generated.

### Degradation

- **AC-35.** IF no derived intent exists for the pull request, THEN the system
  shall produce the brief from the remaining inputs and shall record that the
  intent was absent.
- **AC-36.** IF the blast radius is unavailable or reports a failed index, THEN
  the system shall produce the brief from the remaining inputs and shall record
  that the impact map was absent.
- **AC-37.** WHILE the blast radius reports `index_stale`, the system shall
  state on the brief that its impact information describes an older commit than
  the diff under review.
- **AC-38.** IF the pull request has no linked issue, THEN the system shall
  produce the brief without one and shall not present the absence as an error.
- **AC-39.** IF the pull request has no changed files, THEN the system shall
  present a state saying the PR changes nothing and shall make no model call.
- **AC-40.** IF the structured model call fails or returns a payload that does
  not satisfy the brief's shape after its retries, THEN the system shall report
  that the brief could not be generated, stating the reason.
- **AC-59.** IF a generation fails for any reason, THEN the system shall leave
  any previously stored brief for that pull request unchanged.
- **AC-41.** WHEN a brief was produced with any input absent under AC-35,
  AC-36, or AC-38, the system shall state on the displayed brief which inputs
  were missing.
- **AC-42.** WHEN a brief is displayed, the system shall state that the model
  was given file metadata only and no diff content.

### Navigation

- **AC-43.** WHEN the user activates a review-focus entry whose file is one the
  pull request changed, the system shall open the Files-changed tab at that
  file and line.
- **AC-44.** WHEN the user activates a review-focus entry whose file is not one
  the pull request changed, the system shall open that file on GitHub.
- **AC-45.** The system shall pin every review-focus destination to the pull
  request's head sha, and not to the blast radius's `indexed_sha`.
- **AC-46.** WHEN the user activates a risk's file reference, the system shall
  navigate by the same rules as a review-focus entry.
- **AC-47.** IF the repository's full name or the head sha is unavailable, THEN
  the system shall present the entry without an active link rather than opening
  an unresolvable destination.
- **AC-48.** WHEN the user activates the same review-focus entry twice in
  succession, the system shall return to that location both times.

### Presentation

- **AC-49.** The system shall render the brief on the pull request's Overview
  tab, above the existing intent and blast-radius cards.
- **AC-50.** The system shall render the brief's risk level with a text label
  and not by colour alone.
- **AC-51.** WHEN a brief has never been generated for the pull request, the
  system shall present an empty state offering to generate one and stating that
  generating it spends money.
- **AC-52.** The system shall present the brief's risk level with a label that
  distinguishes it from a review verdict and from a PR score.
- **AC-53.** WHEN a risk is displayed, the system shall show its severity, its
  title, its explanation, and its surviving file references.

### Untrusted input handling

- **AC-54.** WHEN the system places PR text, issue text, or document text into
  the model's input, it shall wrap each in the untrusted-data delimiters used
  by the existing prompt assembly and shall add no keyword scanning of that
  text.
- **AC-55.** WHEN a wrapped text contains the untrusted-block closing
  delimiter, the system shall neutralise that occurrence so the text cannot
  terminate its own block.
- **AC-56.** The system shall resolve every selected document path within the
  target repository's clone directory and shall reject any path that is
  absolute, contains a parent-directory segment, or resolves outside it.
- **AC-57.** WHEN brief text is rendered in the studio, the system shall render
  it without executing embedded HTML or scripts.

## Edge cases

| Case | Handling |
|---|---|
| No derived intent for the PR | AC-35, AC-41 — brief is produced without it and says so. |
| Blast radius failed, or index status `failed` | AC-36, AC-41 — produced without the impact map, recorded. |
| Blast radius is empty on a `full` index | Not a gap. `full` + empty means "nothing downstream", a fact the input carries as-is; no degradation is recorded. |
| Blast index is stale | AC-37 — stated on the brief. Deliberately not folded into "missing input": a stale index is intact, it answers about another commit. |
| PR has no linked issue | AC-38 — not an error. |
| PR changed no files | AC-39 — no model call at all; a PR that changes nothing is a fact, not a data gap. Mirrors the same decision in `BlastService.forPull`. |
| Model returns invalid JSON after retries | AC-40 — reported, previous brief preserved. |
| Model references a file absent from the input | AC-22, AC-23, AC-24 — entry dropped, reason recorded and readable. |
| Model references a line outside every hunk | AC-25 — entry kept, line dropped. The file is real; only the coordinate is unverified. |
| Every reference invented | AC-26 — what/why/risk_level still shown, with the rejection stated. |
| PR pushed while generation is in flight | AC-33 — stored against the sha it described; AC-30 then refuses to serve it as current. |
| Repository re-indexed after the brief was cached | AC-27, AC-30 — `indexed_sha` is part of the key, so the brief is no longer current. |
| Repository has no index at all | AC-28 — an absent `indexed_sha` is its own key value. |
| No candidate document overlaps the changed paths | AC-17 — no documents, recorded. |
| Repository has no clone | Candidate discovery yields nothing; AC-17 applies. Treated as "no documents", because the brief's other inputs do not depend on the clone. |
| Selected documents exceed the token budget | AC-16, AC-18 — tail dropped whole, recorded with the limit that dropped it. |
| Two documents tie on overlap score | AC-14 — the path tie-break makes the ranking total, which is what NFR-11 rests on. |
| Two reviewers press regenerate at once | AC-58 — the second is rejected for the same PR. Beyond that, last write wins; the product is local-first and single-operator. |
| Regeneration pressed while a brief is current | AC-31 — allowed; the control exists precisely to override the cache. |
| Document contains the untrusted closing delimiter | AC-55 — neutralised. |
| Cost is exactly `0` | AC-9 — a real price. Free models exist in the price book; see Verification notes. |
| A file the PR changed is also named by the index at a stale line | AC-45 — the brief pins to head, because the brief's own coordinates come from the diff, not from the index. |
| The PR has more changed files than the input cap | NFR-5 — the input states how many were omitted, so the model is not left to assume it saw everything. |
| The brief's `what`/`why` contradict the derived intent | Out of scope. The brief is one model's synthesis; reconciling it against `Intent` would be a second judgement with no adjudicator. Both are shown, each labelled with its source (Inputs and provenance). |
| A selected document changed on disk after the brief was cached | Not invalidated — see Open question 4. The document set that produced the brief is recorded (AC-18, NFR-14) and regeneration is one action (AC-31). |

## Non-functional requirements

**Performance**

- **NFR-1.** WHEN a stored brief matches both cache keys, the system shall
  return it within 300 ms at p95, measured server-side from request receipt to
  response.
- **NFR-2.** WHEN the system assembles a brief's input on a pull request of at
  most 300 changed files and a repository of at most 1 000 discoverable
  documents, it shall complete the assembly, excluding the model call, within
  3 000 ms at p95.
- **NFR-3.** IF document selection cannot complete within 2 000 ms, THEN the
  system shall proceed with the documents ranked so far and shall record that
  selection was cut short.

**Scale limits**

- **NFR-4.** The system shall include no diff line content in the model's
  input, at any PR size.
- **NFR-5.** The system shall include at most 300 changed files in the model's
  input, and shall state in that input how many further files were omitted.
- **NFR-6.** The system shall include at most 5 documents and at most 4 000
  estimated tokens of document text per brief — a budget that must leave room,
  under NFR-24's total input cap, for the other sections assembled alongside
  documents.
- **NFR-7.** The system shall include at most 20 000 characters of linked-issue
  text and at most 20 000 characters of PR body text in the model's input.
- **NFR-8.** The system shall present at most 10 risks and at most 10
  review-focus entries in one brief, dropping the lowest-ranked beyond that.

**Degradation**

- **NFR-9.** IF any one input to the brief is unavailable, THEN the system
  shall produce the brief from the remaining inputs rather than failing, and
  shall record which input was absent.
- **NFR-10.** IF the model provider is unavailable, THEN the system shall leave
  any stored brief intact and report the provider failure, so a previously good
  brief is never destroyed by a failed regeneration.

**Determinism**

- **NFR-11.** WHEN the same pull request is briefed twice with the same changed
  files and the same discoverable documents, the system shall select the same
  documents in the same order.
- **NFR-12.** The system shall derive the cache key, the document selection,
  the reference validation, and the displayed cost from data alone, with no
  model-generated value among them.
- **NFR-13.** The brief's `what`, `why`, `risk_level`, risks, and review-focus
  entries are model-generated and may differ between two generations of the
  same pull request; the system shall label the brief as model-generated
  wherever it is displayed.
- **NFR-14.** WHEN a brief is stored, the system shall store with it the
  document set that produced it, so the brief remains auditable even though a
  later selection over changed documents would differ.

**Observability**

- **NFR-15.** WHEN a brief is generated, the system shall record the model and
  provider used, the input and output token counts, the cost, the cost source,
  the number of retries, the count of selected documents, the count of dropped
  documents, and the count of entries rejected under AC-22.
- **NFR-16.** The system shall never log the text of a linked issue, a PR body,
  or a project document; logs shall carry paths, sizes, and counts only.

**Accessibility**

- **NFR-17.** The system shall make every review-focus entry, risk reference,
  and the regeneration control reachable and operable by keyboard alone.
- **NFR-18.** WHILE a brief is being generated, the system shall expose a
  status message naming what is in progress.
- **NFR-19.** The system shall convey the risk level, and any degradation
  state, by text and not by colour alone.

**Security and privacy**

- **NFR-20.** The system shall send no source-file content and no diff line
  content to the model provider as part of a brief.
- **NFR-21.** The system shall treat PR text, issue text, and document text as
  untrusted data wherever it reaches the model or the browser.
- **NFR-22.** The system shall not store the model's raw response text beyond
  what the brief's own shape carries, so an unvalidated reference has no second
  path to the user.
- **NFR-23.** The system shall apply a rate limit to brief generation, matching
  the limit already applied to the other money-spending PR routes.
- **NFR-24.** The system shall not send more than 8 000 tokens, counted by the
  tokenizer, in a single brief generation's model input, measured on the
  assembled user message and excluding the system prompt. WHEN the assembled
  input would exceed this budget, the system shall drop whole sections —
  never truncate one — starting from the lowest-priority section (project
  documents first, then the linked issue, PR title/body, blast radius,
  derived intent, and last the changed-file list) until the input fits, and
  shall record which sections were dropped; a brief shall always be
  generated, never rejected for exceeding the budget.

## Inputs and provenance

| Input | Source | Owner | Determinism | Shown as |
|---|---|---|---|---|
| Derived PR intent | `pr_intent`, produced by the existing intent derivation for the PR's head sha | DevDigest | **Model-generated**, persisted | Already shown by `IntentCard`; enters the brief's input as data, labelled as derived |
| Blast summary | `BlastRadius` from the blast module, over the `repo-intel` index | DevDigest | Deterministic given an index; carries its own `index_status`, `degraded`, `indexed_sha`, `index_stale` | Already shown by `BlastRadiusCard`; staleness surfaced on the brief per AC-37 |
| Diff statistics | `pr_files` — path, additions, deletions — plus hunk headers | GitHub | Deterministic | Counts only; no hunk body ever leaves the machine (AC-3, NFR-20) |
| Linked issue | Resolved from the PR body by the existing issue-reference parsing | GitHub, authored by whoever opened the issue | Deterministic resolution of **untrusted** text | Its presence or absence is stated (AC-38, AC-41) |
| Selected documents | The repository clone, under Project Context's configured roots, ranked by path overlap | The repository | Deterministic (NFR-11) | Paths readable per AC-19 |
| `what`, `why`, `risk_level`, `risks[]`, `review_focus[]` | One structured model call | **The model** | **Not deterministic** (NFR-13) | Labelled as model-generated |
| Surviving references | Code validation of the model's references against the input data | DevDigest | Deterministic | Only validated references are presented (AC-20…AC-22) |
| Cost and tokens | The structured call's own result | The provider | Deterministic per call | Price and token counts (AC-8); `0` is a price (AC-9) |
| Cache key | PR head sha and the blast radius's `indexed_sha` | DevDigest | Deterministic | The head sha the brief describes is shown (AC-34) |

Two provenance defects the design must not commit:

**The brief's `risk_level` is not a review verdict and not a PR score.** The
score in `VerdictBanner` is recomputed by `reviewer-core` from findings that
survived grounding against the diff. The brief's model never sees a finding and
never sees a diff line. Presenting them as one gauge would let a `low` brief
sit next to a `Request changes` review and read as a contradiction, when they
are two different measurements of two different things. AC-52 requires the
label to distinguish them.

**Every reference in a brief is a model's claim until code validates it.** The
model proposes; the input data disposes (AC-20…AC-24) — the same division the
review pipeline already applies to findings, where an ungrounded citation is
dropped rather than shown.

## Untrusted inputs

Four inputs cross a trust boundary into the model's prompt and into the
reviewer's browser:

- **The PR title and body** — authored by whoever opened the pull request,
  including an untrusted contributor.
- **The linked issue's title and body** — authored by anyone who can open an
  issue on the repository.
- **The selected project documents** — files in the repository under review; on
  a PR from a fork, attacker-influenced.
- **The model's own output** — untrusted in a second, distinct sense: it may
  name files and endpoints that do not exist, and its text reaches the DOM.

Handling is AC-54 (wrap as untrusted data, one shared guard, no keyword
scanning), AC-55 (neutralise the closing delimiter), AC-56 (path containment
before any filesystem access), AC-20 through AC-24 (reject every invented
reference and record it), AC-57 (render without executing HTML), and NFR-22
(the raw response is not stored, so a rejected reference has no second path to
the user).

Blast radius, diff statistics, and derived intent are DevDigest's own
computations over already-ingested data and are not re-wrapped as untrusted —
the same treatment `run-executor.ts` already gives derived intent.

## Design review

The design was supplied as **two written mockup descriptions**, not as image
files; no mockup image exists in the repository and I did not see the
originals. Any visual detail not captured in the description is unreviewed.

- **D-1 — The `PR BRIEF` card in mockup 1 is two features drawn as one.** Its
  verdict (`Request changes`), its `6 findings · 2 blockers` badge, its
  `PR SCORE 61` ring, and its summary paragraph are precisely the props of the
  existing `VerdictBanner` component, which renders from a completed review.
  Its `what`/`why` paragraph and the risk material below are the new brief. The
  two have different sources, different determinism, and different lifecycles —
  a review's score changes when a review runs; a brief changes when the PR or
  the index moves. Resolved: the score, verdict, and findings counts stay with
  the review (Non-goals); the brief renders its own card with its own risk
  level, labelled so the two cannot be read as one number (AC-49, AC-52).
- **D-2 — `RISK AREAS` sits inside the INTENT panel, but `IntentCard` has no
  such section and no file references at all.** `Intent` carries `intent`,
  `in_scope`, `out_of_scope`, `confidence`, `sources`, `missing_context` —
  nothing with a path. The rows shown (`Auth surface touched —
  src/middleware/ratelimit.ts:12-18`) are the brief's `risks[]`. Resolved: the
  risks render in the brief's card (AC-53); `IntentCard` is untouched
  (Non-goals).
- **D-3 — `Prior PRs touching these files — 3` has no producer.** The
  `PrHistory` contract exists and nothing writes it; no query computes file
  overlap against merged PRs. Rendering a count with no source is the
  provenance defect this review exists to catch. Resolved: Non-goal, exactly as
  SPEC-01 handled its `COVERAGE` ring.
- **D-4 — The cost line `$ $0.014  8.2K→1.3K` is honest and has a real
  source.** `StructuredResult` carries `tokensIn`, `tokensOut`, `costUsd`, and
  `costSource`. Resolved: kept (AC-7, AC-8), with the recorded trap that
  `costUsd === 0` is a real price and must never be tested for truthiness
  (AC-9, AC-10).
- **D-5 — No mockup shows a missing input.** Mockup 1 assumes intent, blast,
  and issue all present. In practice a repository can have no index, a PR can
  have no issue, and intent may never have been derived. Resolved: AC-35,
  AC-36, AC-38, AC-41.
- **D-6 — No mockup shows a rejected reference.** The design shows four
  review-focus rows, all valid. Silently rendering three because one was
  invented would make the brief look complete precisely when the model
  misbehaved. Proposed and resolved as AC-23, AC-24, AC-26.
- **D-7 — No mockup shows the first-run, generating, or failed state.**
  Resolved: AC-51 (never generated, with the spend warning), AC-32 and AC-58 (in
  progress, and no second concurrent generation), AC-40 and AC-59 (failed
  without destroying the stored brief).
- **D-8 — Review-focus rows carry `file:line`, but the mockup does not say
  which commit those coordinates address.** This matters because the adjacent
  blast panel's coordinates address a *different* commit — `indexed_sha`, per
  the recorded trap that a caller line recorded at index time points at
  unrelated code once the index falls behind. The brief's coordinates come from
  the diff, which is the head. Resolved: AC-45 pins review focus to head sha,
  deliberately differing from blast's pinning, and states why, so the two rules
  are not later "unified" into one broken one.
- **D-9 — Proposal: state on the card that the model saw no diff content.**
  The cost line tells the user what was spent but not what was sent, and "the
  model read your code" is the assumption a reviewer will otherwise make.
  Proposed and resolved as AC-42.
- **D-10 — Proposal: the review-focus list is the card's most valuable element
  and the mockup places it last.** Mockup 1 orders the page as
  brief → intent/blast panels → `REVIEW FOCUS — READ THESE FIRST`, so the thing
  labelled "read these first" is the last thing on the screen and, on a
  populated PR, below the fold. Proposed as a UX change: the brief's own card
  carries what/why, risk level, risks, and review focus together, above the
  existing two panels (AC-49). The heading's promise and its position then
  agree.
- **D-11 — Mockup 1's blast panel shows a `Tree/Graph` toggle, a caller tree,
  endpoint badges, and a cron badge.** All of these already exist in
  `BlastRadiusCard`. Recorded as context, not as a requirement: no change.
- **D-12 — Mockup 2 (Files changed) is shown but is not part of this
  feature.** Its role here is as a navigation *destination*. Recorded, with the
  trap that its rows are only addressable under conditions this feature does
  not control — see Verification notes.

## Module interactions

- **Brief generation (server).** A new capability living with the other
  PR-scoped model calls. It consumes: the persisted intent, the blast module's
  `BlastRadius` (through that module's own service, never `repo-intel`
  internals), the PR's files, the GitHub client for the linked issue, the
  document discovery Project Context already owns, the `Tokenizer` port for the
  document budget of AC-16, and an `LLMProvider` resolved per request through
  the existing resolver-function convention, so a missing key fails the one
  request that needs it rather than app startup.
- **Model selection.** `FEATURE_MODELS` already carries a `risk_brief` entry
  with a default provider and model, selectable per workspace in Settings and
  currently wired to nothing. This feature is its consumer; no new settings
  surface is required.
- **Persistence.** The `pr_brief` table (`pr_id` primary key, `json`) exists
  and is unused. It has no column able to carry the cache key of AC-27, so the
  cache key is a change to the stored shape: the row must carry the head sha
  and the `indexed_sha` it was built against, or AC-30 cannot be evaluated at
  all. `pr_id` alone as a primary key also means one brief per PR — which is
  what AC-31 requires, since regeneration replaces rather than accumulates.
- **Blast module.** Consumed read-only, through its service. Its contract
  already answers the two questions the cache key needs — `indexed_sha` and
  `index_stale` — because the server resolves both where it holds the PR head
  and the index sha together. This feature adds nothing to the blast module and
  must not add `llm` to `BlastDeps`, which is that module's stated invariant.
- **Project Context.** Consumed for document discovery and reading only. The
  attachment tables, the agent and skill `Context` tabs, and
  `run-executor.ts#buildProjectContext` are untouched; the brief's selection
  writes nothing into them and reads none of them. This is the boundary that
  keeps the SPEC-01 relationship narrow: a second consumer of the same
  discovery, not a change to the first.
- **Tokenizer port.** Required by AC-16's budget. The same constraint SPEC-01
  recorded applies unchanged: token counting must be available to a second
  consumer without adding a new architectural violation. That it must not add
  one is a requirement here; how is the plan's problem.
- **Shared contract (two-sided).** `PrBrief` in `contracts/brief.ts` is
  currently `{ intent, blast, risks, history }` and has no consumer in either
  package. Its shape must become `{ what, why, risk_level, risks[],
  review_focus[] }`, which is a redefinition of an exported symbol, not an
  addition. `Risk` is reusable as it stands (`kind`, `title`, `explanation`,
  `severity`, `file_refs`); a review-focus entry has no existing shape.
  `PrHistory` loses its only referencing type and becomes wholly orphaned — it
  stays exported and unused, since deleting it is a separate decision (Open
  question 5). **`@devdigest/shared` is vendored twice** —
  `server/src/vendor/shared/` and `client/src/vendor/shared/` — with no sync
  script, and `server/` is canonical; a one-sided edit type-checks in its own
  package and silently desynchronises the API.
- **Client.** A new `PrBriefCard` renders in `OverviewTab` above the existing
  grid. It reuses the page's existing `goToLocation` callback for navigation,
  which already implements the in-PR-versus-GitHub split — but that callback
  currently decides staleness and pins its GitHub URL from the blast index's
  sha, so serving the brief through it unchanged would apply blast's pinning
  rule to head-anchored coordinates, contradicting AC-45. The `brief` message
  namespace exists in `client/messages/en/brief.json` and is referenced by no
  component; its current keys describe the dormant four-block `PrBrief`
  (`block.intent`, `block.blast`, `block.risks`, `block.history`) and do not
  match this feature's card. Its `why.*` subtree belongs to git-why, a
  different feature, and must not be disturbed.
- **MCP.** Not extended by this feature. `get_blast_radius` and the other tools
  are unchanged; whether a brief should be exposed as a tool is Open question 3.

## Traceability

| ID | Serves | Source | Verified by |
|---|---|---|---|
| AC-1 | US-1, US-2 | requirement: brief shape | integration test |
| AC-2 | US-1, US-5 | requirement: named inputs only | integration test |
| AC-3 | US-7, NFR-4 | user decision: no hunk bodies; code: `renderFileList` precedent | unit test |
| AC-4 | Goals §1 | requirement: one structured call | integration test |
| AC-5 | US-2 | requirement: `risk_level` | unit test |
| AC-6 | US-4 | mockup 1 review-focus ordering | unit test |
| AC-7 | US-7 | code: `StructuredResult` carries tokens and cost | integration test |
| AC-8 | US-7 | mockup 1 cost line; design finding D-4 | unit test |
| AC-9 | US-7 | INSIGHTS: `costUsd` of 0 is a real price | unit test |
| AC-10 | US-7 | INSIGHTS: `costUsd` of 0 is a real price | unit test |
| AC-11 | US-5 | user decision: automatic selection (option C) | integration test |
| AC-12 | US-5 | user decision: lexical, no embedding | unit test |
| AC-13 | US-5 | code: Project Context discovery and excluded dirs | integration test |
| AC-14 | US-5, NFR-11 | code: total-order sorting precedent in blast helpers | unit test |
| AC-15 | US-5, NFR-6 | user decision: 5 documents per brief | unit test |
| AC-16 | US-5, NFR-6 | SPEC-01 block-budget precedent | unit test |
| AC-17 | US-5, US-8 | design finding D-5 | unit test |
| AC-18 | US-5, NFR-14 | user decision: selection must be auditable | integration test |
| AC-19 | US-5 | user decision: selection is visible | unit test |
| AC-60 | US-5, NFR-11 | resolved decision 1 (2026-08-25) | unit test |
| AC-61 | US-5, NFR-2 | resolved decision 2 (2026-08-25) | unit test |
| AC-20 | US-3, Goals §4 | user decision: reject invented references | unit test |
| AC-21 | US-3, Goals §4 | user decision: endpoints validated too | unit test |
| AC-22 | US-3 | code: `grounding.ts` drops ungrounded findings | unit test |
| AC-23 | US-3 | user decision: no silent disappearance | integration test |
| AC-24 | US-3, US-8 | design finding D-6 | unit test |
| AC-25 | US-4 | code: `buildLineIndex` hunk coverage | unit test |
| AC-26 | US-3, US-8 | design finding D-6 | unit test |
| AC-27 | US-6 | user decision: head sha + `indexed_sha` | integration test |
| AC-28 | US-6 | code: `indexed_sha` is nullable by design | integration test |
| AC-29 | US-6 | requirement: cache the brief | integration test |
| AC-30 | US-6 | user decision: never serve a stale brief as current | integration test |
| AC-31 | US-6 | mockup 1 regeneration icon | integration test |
| AC-32 | US-6 | design finding D-7 | unit test |
| AC-58 | US-6 | user decision: no concurrent regeneration | integration test |
| AC-33 | US-6 | INSIGHTS: `head_sha` written at creation, not completion | integration test |
| AC-34 | US-6 | user decision: the brief names the state it describes | unit test |
| AC-35 | US-8 | design finding D-5 | integration test |
| AC-36 | US-8 | code: blast degrades, never throws | integration test |
| AC-37 | US-8 | INSIGHTS: blast coordinates belong to `last_indexed_sha` | unit test |
| AC-38 | US-8 | design finding D-5 | integration test |
| AC-39 | Goals §1 | code: `BlastService.forPull` early return on zero files | unit test |
| AC-40 | US-6 | code: `completeStructured` retries then throws | integration test |
| AC-59 | US-6 | design finding D-7; NFR-10 | integration test |
| AC-41 | US-8 | design finding D-5 | unit test |
| AC-42 | US-7 | design finding D-9 | unit test |
| AC-43 | US-4 | code: `goToLocation` in-PR branch | unit test |
| AC-44 | US-4 | code: `goToLocation` GitHub branch | unit test |
| AC-45 | US-4 | design finding D-8; INSIGHTS: index-sha pinning | unit test |
| AC-46 | US-3 | mockup 1 risk rows carry `file:line` | unit test |
| AC-47 | US-4 | code: `goToLocation` returns early without repo identity | unit test |
| AC-48 | US-4 | INSIGHTS: a nonce, not target identity, drives re-navigation | unit test |
| AC-49 | US-1, US-4 | design finding D-10 | unit test |
| AC-50 | US-2 | accessibility review | unit test |
| AC-51 | US-6 | design finding D-7 | unit test |
| AC-52 | US-2 | design finding D-1 | unit test |
| AC-53 | US-3 | mockup 1 risk rows; design finding D-2 | unit test |
| AC-54 | Untrusted inputs | code: `wrapUntrusted`, single injection guard | integration test |
| AC-55 | Untrusted inputs | code: delimiter escaping in `wrapUntrusted` | unit test |
| AC-56 | Untrusted inputs | code: `isContainedPath` guard | unit test |
| AC-57 | Untrusted inputs | design review | unit test |
| NFR-1 | Goals §6 | performance budget for a cache hit | manual review |
| NFR-2 | Goals §1 | performance budget for assembly | manual review |
| NFR-3 | Goals §5 | SPEC-01 deadline-degradation precedent | unit test |
| NFR-4 | Goals §7 | user decision: no hunk bodies | unit test |
| NFR-5 | Goals §7 | code: `MAX_INTENT_FILES` precedent | unit test |
| NFR-6 | Goals §5 | user decision: selection limits | unit test |
| NFR-7 | Goals §7 | code: `MAX_INTENT_ISSUE_CHARS` precedent | unit test |
| NFR-8 | Goals §3 | user decision: presentation caps | unit test |
| NFR-9 | Goals §1 | code: intent degrades per-source, never throws | integration test |
| NFR-10 | US-6 | design finding D-7 | integration test |
| NFR-11 | US-6, Goals §5 | user decision: selection must be deterministic or the cache lies | unit test |
| NFR-12 | Goals §4 | provenance review | manual review |
| NFR-13 | US-1 | provenance review; design finding D-1 | manual review |
| NFR-14 | US-5, US-6 | user decision: the brief carries its own document set | integration test |
| NFR-15 | US-7 | mockup 1 cost line; observability review | integration test |
| NFR-16 | Untrusted inputs | privacy review; SPEC-01 NFR-17 precedent | manual review |
| NFR-17 | US-4 | accessibility review | unit test |
| NFR-18 | US-6 | client loader convention | unit test |
| NFR-19 | US-2, US-8 | accessibility review | unit test |
| NFR-20 | US-7 | user decision: privacy limit | integration test |
| NFR-21 | Untrusted inputs | code: single shared injection guard | integration test |
| NFR-22 | Untrusted inputs | security review | unit test |
| NFR-23 | Goals §1 | code: rate limits on money-spending PR routes | integration test |
| NFR-24 | Goals §7 | user decision: truncate the input to fit an agreed budget, never reject | unit test |

## Verification notes

**The end-to-end check that decides whether this feature works.** Open a pull
request whose changed files include one that a repository document describes as
invariant, generate a brief with a stubbed model that returns one valid
reference and one invented one, and confirm three things at once: the valid
review-focus entry navigates to the right file at the head sha, the invented
entry is absent from the card *and* its rejection is readable, and a second
request with unchanged head and index makes no further model call. This is the
only check that exercises selection, grounding, navigation, and the cache
together; anything narrower verifies mechanism. It needs a database, a
repository fixture, and a stubbed provider, so it belongs in the integration
lane.

**Traps that will make verification lie:**

- **The vendored shared contract is duplicated, and this feature redefines an
  exported symbol in it.** `@devdigest/shared` lives in
  `server/src/vendor/shared/` and `client/src/vendor/shared/` with no sync
  script; `server/` is canonical. Redefining `PrBrief` on one side type-checks
  in that package and silently desynchronises the API. Verification must
  compare the two copies directly — `diff
  server/src/vendor/shared/contracts/brief.ts
  client/src/vendor/shared/contracts/brief.ts` must produce no output — and
  must not accept either package compiling as evidence.
- **`costUsd === 0` is a real price.** The price book lists genuinely free
  models, so a completed brief can legitimately cost exactly zero. Every cost
  check must use `== null` / `!= null`; a truthiness test reclassifies a free
  brief as "unknown" and renders the wrong state. A test asserting AC-9 must
  use a stub returning `0`, not one returning `null`.
- **A Files-changed row is only addressable under conditions this feature does
  not control.** The diff row id exists only on finding-covered lines, and
  reaching a row needs its group open and then its file card open — a
  boilerplate group is closed by default, and a file with no findings does not
  auto-open. A review-focus entry usually points at a line carrying no finding,
  so an AC-43 test asserting only "the tab changed" passes while the reviewer
  lands nowhere. Assert that the row is actually reached.
- **Blast coordinates and brief coordinates address different commits.** Blast
  pins to `indexed_sha`; the brief pins to head (AC-45). A fixture where the
  two shas are equal cannot tell a correct implementation from one that reuses
  blast's rule wholesale. Any test of AC-45 needs `indexed_sha !== head_sha`.
- **A determinism test over one fixture proves nothing about NFR-11.** Two
  documents with equal overlap scores are what exercise the tie-break of AC-14;
  a fixture whose scores are all distinct passes against an unstable sort.
- **`arch:check` exits 0 while reporting violations.** This feature reaches
  Project Context's discovery and the `Tokenizer` port from a new place —
  exactly the kind of change that adds a dependency warning. Judge it by the
  summary line `x N dependency violations (E errors, W warnings)` against the
  recorded baseline of 6 warnings and 0 errors, never by the exit code.
- **`server` typecheck has 2 pre-existing errors** (`db/migrate.ts:38`,
  `db/seed.ts:499`). A green run is impossible; compare against the baseline.
- **Piping a check into `tail` or `head` discards its exit code.** Relevant to
  every verification command run here.
- **`GitClient.readFile` fails in two shapes.** The real client rejects on a
  missing file; the mock returns `''`. A document-selection test built only on
  the mock passes while the real client throws during assembly. Any read path
  must be exercised in both shapes.
- **`@testing-library/user-event` is not installed in the client.** Every
  existing client interaction test uses `fireEvent`; importing user-event fails
  at collection time with an error naming the test file, not the package.
- **Both test lanes running at once fail under contention.** Run the hermetic
  and integration lanes separately.
- **A message-namespace mismatch fails silently.** The `brief` namespace exists
  with keys describing the dormant four-block contract; a card wired to the
  wrong namespace wrapper renders without throwing.

**What needs which kind of check:**

- Hermetic unit tests: document ranking, its tie-break, and its limits (AC-12,
  AC-14…AC-17); reference validation and rejection (AC-20…AC-26); the
  cache-key comparison including the absent-`indexed_sha` case (AC-27, AC-28);
  cost rendering including zero (AC-8…AC-10); path containment (AC-56);
  delimiter neutralisation (AC-55); and the card's rendering of every state —
  never generated, generating, failed, degraded, stale index,
  all-references-rejected (AC-32, AC-37, AC-40…AC-42, AC-49…AC-53, AC-58).
- Database-backed integration tests (`*.it.test.ts`): brief persistence and
  replacement on regeneration (AC-29…AC-31, AC-58, AC-59), the recorded document set and
  rejections (AC-18, AC-23), degradation with each input absent in turn
  (AC-35, AC-36, AC-38), and the head-sha-changed-mid-flight case (AC-33).
- Browser flow: generate a brief, click a review-focus entry into the Files
  changed tab, click one that leaves for GitHub (US-4).
- Manual review: the performance budgets (NFR-1, NFR-2) and the provenance and
  privacy claims (NFR-12, NFR-13, NFR-16), which have no automated harness
  here.
- **Awkward to verify, flagged deliberately:** AC-33 needs a head-sha change
  interleaved with an in-flight generation and has no current test seam; NFR-2
  depends on a repository fixture of realistic size that does not exist yet;
  NFR-20 ("no source content was sent") is a negative claim, best checked by
  asserting on the assembled prompt rather than on the provider, since the
  provider is stubbed in every lane.

## Resolved decisions

The five questions this spec opened were answered on 2026-08-25; each stated
assumption was accepted as written. They are recorded here rather than deleted,
so a later reader can see what was decided and on what grounds.

1. **Lexical overlap is the count of shared path segments.** A document's
   score is the number of repository-relative path segments it shares with any
   changed file path, extensions ignored; a document sharing none scores zero
   and is excluded by AC-17. Fixed as **AC-60**. No existing code computed
   anything comparable — `code_chunks`, with its `source: 'docs' | 'spec'
   discriminator and its embedding column, is referenced nowhere. A better
   signal may replace this one without changing any other criterion, provided
   it keeps AC-12 (no model, no embedding) and AC-14 (total order).
2. **Selection reads paths only, never document content.** Fixed as
   **AC-61**. Content matching would find a document naming a changed symbol
   under an unrelated path, but reading up to 1 000 documents before ranking
   conflicts with NFR-2's assembly budget. Revisiting this means revisiting
   NFR-2.
3. **The brief is not exposed as an MCP tool.** `get_blast_radius` sets a
   precedent and the feature fits it, but MCP is out of scope here. Adding it
   later requires no change to any criterion, since generation is not an HTTP
   concern.
4. **A brief is not invalidated when a selected document changes on disk.**
   AC-27's key covers the PR head and the index, not document content, so an
   edited document leaves a cached brief current. The selected set is recorded
   (AC-18) and regeneration is one action (AC-31); hashing every selected
   document on every read would violate NFR-1. **Known limitation, accepted.**
5. **`PrHistory` is left exported and unused.** This spec orphans it by
   redefining `PrBrief`. Deleting a shared contract is a two-sided vendored
   edit with no benefit to this feature.

## Open questions

None.
