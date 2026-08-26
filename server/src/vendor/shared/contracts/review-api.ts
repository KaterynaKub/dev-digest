import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff, PrBrief, BriefProvenance, BriefTimelineEntry } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes + freshness). */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  /** PR head sha the intent was derived against; null if never derived. */
  head_sha: z.string().nullable(),
  /** ISO timestamp of the last derivation; null if never derived. */
  derived_at: z.string().nullable(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Body for POST /pulls/:id/intent/derive. `force` bypasses the freshness check. */
export const IntentDeriveRequest = z
  .object({ force: z.boolean().optional() })
  .optional();
export type IntentDeriveRequest = z.infer<typeof IntentDeriveRequest>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/**
 * A persisted PR brief (SPEC-02): the model-generated `PrBrief` plus the
 * provenance that lets a client decide whether it is current (AC-29, AC-30)
 * and render its cost, cache key, and degradation state (AC-34, AC-41).
 * Response of `GET /pulls/:id/brief`; `null` when no brief has ever been
 * generated (AC-51).
 */
export const PrBriefRecord = PrBrief.extend({
  pr_id: z.string(),
  provenance: BriefProvenance,
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;

/**
 * Response of `GET /pulls/:id/brief/timeline` (0003) — the retained brief
 * history, newest first. An object rather than a bare array, matching
 * `ContextDocReader.listDocuments`'s `{ docs }` shape and leaving room for a
 * future `truncated` flag without a breaking change.
 */
export const BriefTimelineResponse = z.object({
  entries: z.array(BriefTimelineEntry),
});
export type BriefTimelineResponse = z.infer<typeof BriefTimelineResponse>;

/** Body for POST /pulls/:id/brief/generate. Always regenerates (AC-31); no
 *  fields today, kept as an object (not `.optional()`) so a future field
 *  (e.g. an explicit `force`) is additive, matching `IntentDeriveRequest`. */
export const BriefGenerateRequest = z.object({}).optional();
export type BriefGenerateRequest = z.infer<typeof BriefGenerateRequest>;
