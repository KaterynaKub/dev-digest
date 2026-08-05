import type {
  ConventionCandidate,
  ConventionExtraction,
  ConventionScan,
  ConventionSkillDraft,
  ConventionStatus,
  FeatureModelChoice,
  Provider,
  SkillType,
} from '@devdigest/shared';
import {
  MAX_EVIDENCE_LINES,
  MIN_RULE_LENGTH,
} from './constants.js';

/**
 * Pure helpers for the conventions module — the evidence-verification gate,
 * line slicing/numbering, the merged-skill markdown builder, and the model
 * choice resolver.
 *
 * NO imports from ./repository.js or ./service.js: every row shape a caller
 * needs is declared structurally below. That cycle is exactly what bit
 * `modules/agents` (helpers.ts ⇄ repository.ts, a tracked `no-circular`
 * warning); `modules/skills` avoids it the same way and this module must not
 * reintroduce it.
 *
 * Everything here takes plain data — no ports, no I/O — so the gate that
 * decides whether the product hallucinates is testable with zero mocks.
 */

// ============================================================ line utilities

/** Split on newlines, tolerating CRLF. Trailing newline does NOT create a
 *  phantom last line, so `lineCount("a\nb\n") === 2`. */
export function splitLines(content: string): string[] {
  const normalised = content.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Number of addressable lines in a file. */
export function lineCount(content: string): number {
  return splitLines(content).length;
}

/**
 * 1-based INCLUSIVE slice. Returns '' when the range is out of bounds or
 * inverted — callers treat '' as "not verified" rather than special-casing.
 */
export function sliceLines(content: string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return '';
  if (start < 1 || end < start) return '';
  const lines = splitLines(content);
  if (start > lines.length) return '';
  return lines.slice(start - 1, Math.min(end, lines.length)).join('\n');
}

/**
 * Prefix each line with its 1-based number, right-aligned to a common width:
 *
 *     8| const x = 1;
 *     9| const y = 2;
 *    10| const z = 3;
 *
 * The model CANNOT produce a verifiable line range without these — every
 * candidate would fail the gate and the feature would return nothing. The
 * alignment is padded to the widest number so the column stays readable across
 * the 9→10 and 99→100 boundaries.
 */
export function numberLines(content: string, startAt = 1): string {
  const lines = splitLines(content);
  if (lines.length === 0) return '';
  const width = String(startAt + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startAt + i).padStart(width, ' ')}| ${line}`)
    .join('\n');
}

// ========================================================== rule comparison

/** Normalise a rule for fuzzy comparison: lowercase, alphanumerics only. */
export function normaliseRule(rule: string): string {
  return rule.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * True when two rules are the same rule differently phrased.
 *
 * Deliberately CONSERVATIVE — exact match after normalisation only. A looser
 * similarity metric would silently swallow a genuinely new rule; a near-miss
 * showing up as a second card is the cheaper failure, because a human can
 * reject it in one click but cannot recover a rule they never saw.
 */
export function isDuplicateRule(a: string, b: string): boolean {
  const na = normaliseRule(a);
  const nb = normaliseRule(b);
  return na.length > 0 && na === nb;
}

// ========================================================== verification gate

/** One file that was actually READ and shown to the model. Declared
 *  structurally (see the module comment) — never imported from the service. */
export interface SampledFile {
  path: string;
  /** Full (possibly truncated) content exactly as sent to the model. */
  content: string;
}

/** A candidate that passed every gate, with its snippet sliced off disk. */
export interface VerifiedCandidate {
  category: string;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  /** Sliced from the sampled content BY US — never the model's own text. */
  evidenceSnippet: string;
  confidence: number;
}

export interface DroppedCandidate {
  candidate: ConventionExtraction;
  reason: string;
}

export interface VerificationResult {
  kept: VerifiedCandidate[];
  dropped: DroppedCandidate[];
}

/**
 * The evidence gate. Mirrors `reviewer-core`'s `groundFindings` kept/dropped
 * shape: a MECHANICAL check, never a second model call.
 *
 * A candidate survives only when the file it cites was actually sampled AND
 * the line range it cites really exists in that file. This is what stops a
 * confidently-worded invented rule: a model that fabricates a convention also
 * fabricates a plausible-looking `:230-245` in a 40-line file, and that is
 * arithmetic we can check.
 *
 * The snippet on a kept candidate is sliced here, from the sampled content —
 * so it is ground truth regardless of what the model claimed.
 */
export function verifyCandidates(
  candidates: ConventionExtraction[],
  files: SampledFile[],
): VerificationResult {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const kept: VerifiedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];

  for (const candidate of candidates) {
    const {
      evidence_path: path,
      evidence_start_line: start,
      evidence_end_line: end,
      rule,
    } = candidate;

    // 1. The file must have been sampled. EXACT match, never endsWith — a
    //    fuzzy match would let "users.ts" resolve to the wrong "users.ts".
    const content = byPath.get(path);
    if (content === undefined) {
      dropped.push({ candidate, reason: `cited a file that was not sampled: ${path}` });
      continue;
    }

    // 2. Empty content is not evidence. Also covers MockGitClient.readFile,
    //    which returns '' where the real client throws.
    if (content.length === 0) {
      dropped.push({ candidate, reason: `cited an empty file: ${path}` });
      continue;
    }

    // 3. The range must be sane.
    if (start < 1 || end < start) {
      dropped.push({ candidate, reason: `invalid line range ${start}-${end} in ${path}` });
      continue;
    }
    if (end - start >= MAX_EVIDENCE_LINES) {
      dropped.push({
        candidate,
        reason: `line range ${start}-${end} spans more than ${MAX_EVIDENCE_LINES} lines`,
      });
      continue;
    }

    // 4. The range must EXIST. This is the check that kills hallucinations.
    const total = lineCount(content);
    if (end > total) {
      dropped.push({
        candidate,
        reason: `cited lines ${start}-${end} but ${path} has only ${total}`,
      });
      continue;
    }

    // 5. The sliced snippet must be substantive — a range of blank lines is
    //    technically in-bounds but shows a reader nothing.
    const snippet = sliceLines(content, start, end);
    if (snippet.trim().length === 0) {
      dropped.push({ candidate, reason: `lines ${start}-${end} of ${path} are blank` });
      continue;
    }

    // 6. The rule text must be substantive and not already kept in this batch.
    if (rule.trim().length < MIN_RULE_LENGTH) {
      dropped.push({ candidate, reason: 'rule text is too short to be meaningful' });
      continue;
    }
    if (kept.some((k) => isDuplicateRule(k.rule, rule))) {
      dropped.push({ candidate, reason: 'duplicate of a rule already kept in this batch' });
      continue;
    }

    kept.push({
      category: candidate.category.trim(),
      rule: rule.trim(),
      evidencePath: path,
      evidenceStartLine: start,
      evidenceEndLine: end,
      evidenceSnippet: snippet,
      confidence: candidate.confidence,
    });
  }

  return { kept, dropped };
}

// ======================================================== model choice

/** The `{ provider, model }` a scan should use, when the request supplied one. */
export interface ScanModelRequest {
  provider?: Provider | undefined;
  model?: string | undefined;
}

/**
 * Resolve which model a scan runs on, in priority order:
 *   1. the per-scan choice in the request body
 *   2. the workspace's Settings → Feature Models override
 *   3. this module's cheap default
 *
 * A PARTIAL request (only `provider`, or only `model`) is ignored entirely
 * rather than being merged with the override — mixing a provider from one
 * source with a model from another produces a pair that does not exist.
 */
export function resolveScanModel(
  request: ScanModelRequest | undefined,
  override: FeatureModelChoice | undefined,
  fallback: FeatureModelChoice,
): FeatureModelChoice {
  if (request?.provider && request.model) {
    return { provider: request.provider, model: request.model };
  }
  return override ?? fallback;
}

// ============================================================ DTO mapping

/** Structural shape of a persisted `conventions` row. */
export interface ConventionRowLike {
  id: string;
  scanId: string;
  category: string;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceSnippet: string;
  confidence: number;
  status: string;
  edited: boolean;
}

/** Structural shape of a persisted `convention_scans` row. */
export interface ConventionScanRowLike {
  id: string;
  repoId: string;
  sampleCount: number;
  configCount: number;
  candidatesRaw: number;
  candidatesKept: number;
  model: string;
  createdAt: Date;
}

export function toCandidateDto(row: ConventionRowLike): ConventionCandidate {
  return {
    id: row.id,
    scan_id: row.scanId,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status as ConventionStatus,
    edited: row.edited,
  };
}

export function toScanDto(row: ConventionScanRowLike): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    sample_count: row.sampleCount,
    config_count: row.configCount,
    candidates_raw: row.candidatesRaw,
    candidates_kept: row.candidatesKept,
    model: row.model,
    created_at: row.createdAt.toISOString(),
  };
}

// ============================================================ skill markdown

/** Lowercase, hyphenated slug. Duplicated from `modules/skills/helpers.ts`
 *  (6 lines) rather than imported: a cross-module helper import would be a
 *  novel precedent for six lines of string munging. */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'conventions'
  );
}

const FENCE_LANGUAGES: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  md: 'md',
  yml: 'yaml',
  yaml: 'yaml',
  css: 'css',
  html: 'html',
  sh: 'bash',
};

/** Fence language inferred from a path's extension; '' when unknown. */
export function fenceLangFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return FENCE_LANGUAGES[ext] ?? '';
}

/**
 * The shortest backtick fence that can safely wrap `snippet`.
 *
 * A snippet containing a ``` run (a JSDoc example, a sampled markdown file)
 * would otherwise terminate the fence early and corrupt the ENTIRE document,
 * not just its own block. Widening the fence past the longest internal run is
 * the standard markdown escape.
 */
export function fenceFor(snippet: string): string {
  let longest = 0;
  for (const match of snippet.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/** A rule row as the markdown builder needs it. */
export interface DraftRow {
  category: string;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceSnippet: string;
}

/** First `n` words of a string — used to build a stable per-rule heading. */
function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(' ');
}

/** Title-case a repo name for the skill's display name. */
function titleCase(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** The 3 most frequent categories, most frequent first. */
function topCategories(rows: DraftRow[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([category]) => category);
}

/**
 * Build the merged skill draft from accepted candidates. NOTHING is persisted:
 * the client edits this freely and confirms via a normal `POST /skills`,
 * mirroring the `POST /skills/import/preview` → `POST /skills` two-step.
 *
 * `repoFullName` is the display name ("acme/payments-api"); `repoName` is the
 * bare name used for the slug.
 */
export function buildSkillDraft(
  repoFullName: string,
  repoName: string,
  rows: DraftRow[],
): ConventionSkillDraft {
  const slug = `${slugify(repoName)}-conventions`;
  const name = `${titleCase(repoName)} Conventions`;

  const categories = topCategories(rows);
  const description =
    rows.length === 0
      ? `Conventions extracted from ${repoFullName}.`
      : `${rows.length} convention${rows.length === 1 ? '' : 's'} extracted from ` +
        `${repoFullName}${categories.length > 0 ? `: ${categories.join(', ')}` : ''}.`;

  const sections = rows.map((row) => {
    const heading = slugify(`${row.category} ${firstWords(row.rule, 4)}`);
    const fence = fenceFor(row.evidenceSnippet);
    const lang = fenceLangFor(row.evidencePath);
    const range = `${row.evidencePath}:${row.evidenceStartLine}-${row.evidenceEndLine}`;
    return [
      `## ${heading}`,
      '',
      row.rule,
      '',
      `Detected in \`${range}\`:`,
      '',
      `${fence}${lang}`,
      row.evidenceSnippet,
      fence,
    ].join('\n');
  });

  const body = [
    `# ${slug}`,
    '',
    `Conventions extracted from \`${repoFullName}\`. Each rule below is backed by`,
    'code in the repository at the time of extraction.',
    ...(sections.length > 0 ? ['', ...sections.flatMap((s) => [s, ''])] : ['']),
  ]
    .join('\n')
    .trimEnd();

  const evidenceFiles = [...new Set(rows.map((r) => r.evidencePath))].sort();

  return {
    slug,
    name,
    description,
    type: 'convention' as SkillType,
    body: `${body}\n`,
    evidence_files: evidenceFiles,
    merged_count: rows.length,
  };
}
