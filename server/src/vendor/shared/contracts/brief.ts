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

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
