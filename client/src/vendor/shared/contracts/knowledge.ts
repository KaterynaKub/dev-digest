import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// A skill parsed from an uploaded file/archive but NOT YET persisted — the
// response shape of `POST /skills/import/preview`. No `id`/`enabled`/`version`:
// those only exist once the (editable) draft is confirmed via `POST /skills`.
export const SkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  // Archive-relative path of the entry the draft was extracted from, e.g.
  // "skills/test-quality/SKILL.md" — null/absent for a single uploaded file.
  source_entry: z.string().nullish(),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

// An immutable snapshot of a skill's `body` at a given version, recorded in
// `skill_versions` whenever the body changes (see server's
// modules/skills/CLAUDE.md for the narrower-than-agents versioning rule: only
// `body` bumps the version).
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---- Conventions ----
// Three states, not a boolean: the UI must distinguish "explicitly rejected"
// from "not looked at yet", otherwise a "Reject all" cannot survive a reload.
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * Model-facing shape: what ONE structured call returns per candidate. No id and
 * no status (assigned at persistence), and deliberately NO snippet — the
 * verifier slices the snippet off disk itself from the cited line range, so the
 * model has one less thing to fabricate and the snippet is ground truth.
 */
export const ConventionExtraction = z.object({
  category: z.string().min(1).max(60),
  rule: z.string().min(1).max(400),
  evidence_path: z.string().min(1),
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/** Batch wrapper — providers' structured mode needs an object root. */
export const ConventionExtractionResult = z.object({
  candidates: z.array(ConventionExtraction),
});
export type ConventionExtractionResult = z.infer<typeof ConventionExtractionResult>;

/** A persisted, code-verified candidate — the HTTP DTO. */
export const ConventionCandidate = z.object({
  id: z.string(),
  scan_id: z.string(),
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int(),
  evidence_end_line: z.number().int(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  edited: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/**
 * One extraction run. Backs the "Detected from N sample files · last scan 1h
 * ago" subtitle AND is the audit trail for the verification gate:
 * `candidates_raw - candidates_kept` is how many the model hallucinated.
 */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  sample_count: z.number().int(),
  config_count: z.number().int(),
  candidates_raw: z.number().int(),
  candidates_kept: z.number().int(),
  model: z.string(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** `GET /repos/:id/conventions` — the whole page in one response. */
export const ConventionsView = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsView = z.infer<typeof ConventionsView>;

/**
 * `GET /repos/:id/conventions/skill-draft` — the server-built merged markdown
 * for the accepted candidates. Nothing is persisted: the client edits this
 * freely and confirms via a normal `POST /skills`, mirroring the
 * `POST /skills/import/preview` → `POST /skills` two-step.
 */
export const ConventionSkillDraft = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  evidence_files: z.array(z.string()),
  merged_count: z.number().int(),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;
