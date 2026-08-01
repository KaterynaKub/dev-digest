import { z } from 'zod';

/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  'finding',
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

export const TrifectaComponent = z.enum([
  'private_data_access',
  'untrusted_input',
  'exfil_path',
]);
export type TrifectaComponent = z.infer<typeof TrifectaComponent>;

export const TrifectaEvidence = z.object({
  component: TrifectaComponent,
  file: z.string(),
  line: z.number().int(),
});
export type TrifectaEvidence = z.infer<typeof TrifectaEvidence>;

/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 */
export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  kind: FindingKind.nullish(),
  // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
  trifecta_components: z.array(TrifectaComponent).nullish(),
  evidence: z.array(TrifectaEvidence).nullish(),
});
export type Finding = z.infer<typeof Finding>;

/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.',
    ),
  findings: z.array(Finding),
});
export type Review = z.infer<typeof Review>;

/** Action taken on a finding (accept/dismiss/learn/reply). */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply']);
export type FindingActionKind = z.infer<typeof FindingActionKind>;

export const FindingAction = z.object({
  action: FindingActionKind,
  reply: z.string().optional(),
});
export type FindingAction = z.infer<typeof FindingAction>;

// ---- Findings roll-up (PR list column + timeline hover panel) ----

/** Per-severity counts. All three keys are always present (zero when absent). */
export const SeverityCounts = z.object({
  CRITICAL: z.number().int().nonnegative(),
  WARNING: z.number().int().nonnegative(),
  SUGGESTION: z.number().int().nonnegative(),
});
export type SeverityCounts = z.infer<typeof SeverityCounts>;

/**
 * Compact projection of a Finding for hover/preview surfaces. Deliberately NOT
 * `Finding`: `rationale` is truncated server-side and `suggestion`/`evidence`/
 * trifecta fields are omitted, so shipping every PR's findings on the list
 * endpoint stays cheap.
 */
export const FindingSummary = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** Truncated to RATIONALE_PREVIEW_CHARS on a word boundary, with an ellipsis. */
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export type FindingSummary = z.infer<typeof FindingSummary>;

/**
 * Findings roll-up attached to a PR list row. `counts` covers ALL of the latest
 * review's findings; `items` is capped, so `truncated` drives a "+N more" hint.
 */
export const PrFindings = z.object({
  counts: SeverityCounts,
  /** Severity-ordered (CRITICAL first), capped at FINDINGS_PREVIEW_LIMIT. */
  items: z.array(FindingSummary),
  /** Total findings minus items.length. */
  truncated: z.number().int().nonnegative(),
});
export type PrFindings = z.infer<typeof PrFindings>;

/** Caps for the eager list payload — the hover panel is a preview, not a browser. */
export const FINDINGS_PREVIEW_LIMIT = 12;
/**
 * Sized to the hover panel's 2-line clamp: ~356px of usable width at 12px
 * renders ~65 chars/line, so ~130 chars fill the clamp. The margin above that
 * keeps the CSS ellipsis — not this cut — the thing users see.
 */
export const RATIONALE_PREVIEW_CHARS = 150;
