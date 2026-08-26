import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
/** Where one contributing input to a derived Intent came from. */
export const IntentSource = z.enum([
  'pr_title',
  'pr_body',
  'linked_issue',
  'spec_file',
  'external_link',
  'file_list',
]);
export type IntentSource = z.infer<typeof IntentSource>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  /** 0-1 self-reported confidence, clamped/capped server-side. Absent = unknown. */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .describe(
      'Confidence (0-1) that this intent/scope is correct. With an empty or absent PR body, this MUST be <= 0.4.',
    ),
  /** Which inputs actually contributed to this intent — code narrows this, the model only proposes. */
  sources: z
    .array(IntentSource)
    .nullish()
    .describe('Which inputs you actually used (only ones present in the prompt).'),
  /** What could not be fetched/resolved, in plain words — never invent content instead. */
  missing_context: z
    .array(z.string())
    .nullish()
    .describe(
      'Notes about referenced context (issue, spec, link) that could not be fetched — never guess its content.',
    ),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/**
 * State of the repo-intel index the map was built from. Never omitted — a
 * consumer must be able to tell "index is full, downstream really is empty"
 * apart from "index is missing/partial, downstream is unknown". See
 * `specs/0007-blast-radius.md` §4.2 (decision: variant B).
 */
export const BlastIndexStatus = z.enum(['full', 'partial', 'degraded', 'failed']);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  /** State of the index this map was built from. Never omitted. */
  index_status: BlastIndexStatus,
  /** true when the map was built on incomplete data. */
  degraded: z.boolean(),
  /** Machine-readable degradation reason; null on a full index. */
  reason: z.string().nullish(),
  /**
   * The commit the index was built from (`repo_index_state.last_indexed_sha`),
   * or null when there is no index to name one. EVERY `file`/`line` in
   * `downstream` is a coordinate in THIS commit's tree, not in the PR's head —
   * the indexer recorded them when it walked that revision. A consumer that
   * deep-links a caller must pin the link to this sha: resolving `file:line`
   * against the PR head silently lands on whatever text happens to occupy that
   * line number now, which drifts further the longer the index goes unrefreshed.
   *
   * `nullable`, not `nullish` — the mapper builds this object field by field, so
   * TypeScript can enforce that it is answered rather than forgotten (see
   * client/INSIGHTS.md on `nullish()` at the boundary).
   */
  indexed_sha: z.string().nullable(),
  /**
   * true when `indexed_sha` differs from the PR's head sha: the map describes an
   * OLDER revision than the diff being reviewed. Computed on the server, which
   * holds both shas, so no consumer has to re-derive it — the same discipline as
   * `degraded`. A stale map is not a degraded one: the index is intact and its
   * `index_status` still means what it says; it simply answers about a different
   * commit, so counts may omit callers added since.
   */
  index_stale: z.boolean(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One flagged line, carrying what flagged it and how to navigate to it. */
export const SmartDiffFindingMark = z.object({
  line: z.number().int(),
  severity: Severity,
  finding_id: z.string(),
  review_id: z.string(),
});
export type SmartDiffFindingMark = z.infer<typeof SmartDiffFindingMark>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
  finding_marks: z.array(SmartDiffFindingMark).nullish(),
  finding_count: z.number().int().nonnegative().nullish(),
  is_large: z.boolean().nullish(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Review focus (PR Why + Risk Brief, SPEC-02) ----
/**
 * One "read this first" entry. `line` is `nullable`, not `nullish` — the
 * validator (server `modules/brief/helpers.ts#validateReferences`) builds this
 * object field by field, so an out-of-hunk line is an ANSWERED `null` rather
 * than an omitted field (AC-25). `file` must be a path present in the brief's
 * own input data (AC-20); an entry naming an absent file or endpoint is
 * dropped whole, never partially kept (AC-22).
 */
export const ReviewFocusEntry = z.object({
  file: z.string(),
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusEntry = z.infer<typeof ReviewFocusEntry>;

/**
 * Everything about HOW a brief was produced, distinct from what it says
 * (`what`/`why`/`risk_level`/`risks`/`review_focus`). Carries the cache key
 * (`head_sha` + `indexed_sha`, AC-27/AC-28), the degradation record
 * (`missing_inputs`, AC-35/AC-36/AC-38/AC-41), the document-selection audit
 * trail (`selected_docs`/`dropped_docs`, AC-18), the rejected-reference record
 * (`rejected_entries`, AC-22/AC-23/AC-24), and the model/cost observability
 * fields (AC-7/AC-8, NFR-15).
 */
export const BriefProvenance = z.object({
  /** PR head sha the brief's diff-derived input was assembled from. */
  head_sha: z.string(),
  /**
   * `nullable`, not `nullish` — an absent index is a DISTINCT key value
   * (AC-28), not an omitted field. Mirrors `BlastRadius.indexed_sha`.
   */
  indexed_sha: z.string().nullable(),
  /** true when the blast radius this brief consumed reported `index_stale` (AC-37). */
  index_stale: z.boolean(),
  generated_at: z.string(),
  /** Plain-language notes on inputs absent from this generation (AC-35, AC-36, AC-38, AC-41). */
  missing_inputs: z.array(z.string()),
  /** Repo-relative path + rank of every document actually selected (AC-18, AC-19, NFR-14). */
  selected_docs: z.array(z.object({ path: z.string(), rank: z.number().int() })),
  /** Every candidate document dropped by a selection limit, and which one (AC-15, AC-16, AC-18). */
  dropped_docs: z.array(
    z.object({ path: z.string(), limit: z.enum(['count', 'tokens']) }),
  ),
  /**
   * NFR-24: labels of whole SECTIONS dropped from the assembled input to fit
   * `MAX_BRIEF_INPUT_TOKENS` (tokenizer-counted tokens of the assembled user
   * message, excluding the system prompt) — never a partial section. A
   * document section's label is `document:<path>`; the fixed non-document
   * labels are `changed-files`, `derived-intent`, `blast-radius`,
   * `pr-title-body`, `linked-issue`. Distinct from `dropped_docs`, which
   * records a document dropped from CANDIDATE SELECTION before assembly,
   * not from the assembled input's token budget.
   */
  dropped_sections: z.array(z.string()),
  /** Every risk/review-focus entry the model proposed but code rejected, and why (AC-22, AC-23, AC-24). */
  rejected_entries: z.array(z.object({ entry: z.string(), reason: z.string() })),
  model: z.string(),
  provider: z.string(),
  /**
   * Nullable, not optional — the fields below are answered from
   * `StructuredResult` field by field. `?? null`, never `|| null`: `0` is a
   * real token count / a real price, not an absent one (server/INSIGHTS.md on
   * `costUsd`).
   */
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  cost_source: z.string().nullable(),
  retries: z.number().int(),
});
export type BriefProvenance = z.infer<typeof BriefProvenance>;

// ---- Composed PR Brief (pr_brief.json) ----
/**
 * Redefinition, not an extension (Module interactions, SPEC-02): the previous
 * `{ intent, blast, risks, history }` shape had no consumer in either package.
 * The model produces `what`/`why`/`risk_level`/`risks`/`review_focus`
 * (NFR-13); `RiskSeverity` and `Risk` are reused as-is.
 */
export const PrBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusEntry),
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Why Timeline (0003) ----
/**
 * One trimmed entry in a PR's brief history — "how the intent changed across
 * commits", not a full brief. Keyed by the commit it describes (`head_sha` +
 * `indexed_sha`), not by an id — a same-key regeneration replaces this entry
 * rather than appending a new one (0003 Requirements review).
 */
export const BriefTimelineEntry = z.object({
  head_sha: z.string(),
  /**
   * `nullable`, not `nullish` — an absent index is an ANSWERED `null`
   * (AC-28), mirroring `BriefProvenance.indexed_sha`.
   */
  indexed_sha: z.string().nullable(),
  generated_at: z.string(),
  risk_level: RiskSeverity,
  what: z.string(),
  /** true when this entry matches the PR's current head sha AND the blast
   *  radius's current indexed_sha — same rule as `PrBriefRecord.is_current`. */
  is_current: z.boolean(),
});
export type BriefTimelineEntry = z.infer<typeof BriefTimelineEntry>;
