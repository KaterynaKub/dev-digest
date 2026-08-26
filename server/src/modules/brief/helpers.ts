/**
 * Pure domain logic for the brief module (layer 2 — Domain Services). Every
 * export here is a pure function: no `await`, no port call, no I/O. Imports
 * only `@devdigest/shared` types and `./constants.js` — never a port, never
 * `db/**`, never an adapter, never another module's `helpers.ts`
 * (`helpers-are-pure`, matched on the literal filename `helpers.ts`).
 */
import type { UnifiedDiff } from '@devdigest/shared';
import { MAX_BRIEF_FILES, MAX_BRIEF_DOCS, MAX_BRIEF_DOC_TOKENS, MAX_BRIEF_INPUT_TOKENS } from './constants.js';

// ---------------------------------------------------------------------------
// Document selection (AC-11…AC-19, AC-60, AC-61)
// ---------------------------------------------------------------------------

/**
 * Strip a file extension and split into repo-relative path segments.
 * `docs/adr/0001-foo.md` → `['docs', 'adr', '0001-foo']`.
 */
function pathSegments(path: string): string[] {
  const withoutExt = path.replace(/\.[^/.]+$/, '');
  return withoutExt.split('/').filter((s) => s.length > 0);
}

/**
 * AC-60: score a candidate document by the number of repo-relative path
 * segments it shares with ANY changed file path, extensions ignored. A
 * document sharing no segment with any changed path scores 0 (AC-17).
 * Reads paths alone (AC-61) — never a document's content.
 */
export function scoreDocument(docPath: string, changedPaths: string[]): number {
  const docSegments = new Set(pathSegments(docPath));
  let best = 0;
  for (const changed of changedPaths) {
    const changedSegments = pathSegments(changed);
    let shared = 0;
    for (const seg of changedSegments) {
      if (docSegments.has(seg)) shared++;
    }
    if (shared > best) best = shared;
  }
  return best;
}

export interface RankedDocument {
  path: string;
  score: number;
}

/**
 * AC-14: rank candidates by score descending, tie-broken by repo-relative
 * path ascending — a TOTAL order, which is what NFR-11's determinism rests
 * on (two documents of equal score must always come out in the same
 * relative order). AC-17: a document scoring 0 is dropped entirely, never
 * just ranked last.
 */
export function rankDocuments(docPaths: string[], changedPaths: string[]): RankedDocument[] {
  return docPaths
    .map((path) => ({ path, score: scoreDocument(path, changedPaths) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path.localeCompare(b.path)));
}

export interface DocLimitResult {
  kept: RankedDocument[];
  dropped: { path: string; limit: 'count' | 'tokens' }[];
}

/**
 * AC-15/AC-16: keep the ranking's head, drop whole documents from the tail —
 * never truncate a document's content and never drop from the middle. The
 * count cap (AC-15) is applied first, then the token budget (AC-16) walks
 * what remains and drops the first document that would exceed it, together
 * with everything after it (dropping from the tail, not just the one over
 * the line, keeps the "documents actually included" set contiguous with the
 * ranking).
 */
export function applyDocLimits(
  ranked: RankedDocument[],
  tokensOf: (path: string) => number,
): DocLimitResult {
  const dropped: { path: string; limit: 'count' | 'tokens' }[] = [];

  const withinCount = ranked.slice(0, MAX_BRIEF_DOCS);
  for (const d of ranked.slice(MAX_BRIEF_DOCS)) dropped.push({ path: d.path, limit: 'count' });

  const kept: RankedDocument[] = [];
  let tokenTotal = 0;
  let overBudget = false;
  for (const d of withinCount) {
    if (overBudget) {
      dropped.push({ path: d.path, limit: 'tokens' });
      continue;
    }
    const tokens = tokensOf(d.path);
    if (tokenTotal + tokens > MAX_BRIEF_DOC_TOKENS) {
      overBudget = true;
      dropped.push({ path: d.path, limit: 'tokens' });
      continue;
    }
    tokenTotal += tokens;
    kept.push(d);
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// File list rendering (AC-3, NFR-4, NFR-5)
// ---------------------------------------------------------------------------

/**
 * One line per changed file: `path (+A/-D) @@ -a,b +c,d @@ …` built from
 * `hunks[]`. NO line content — only path + hunk headers (AC-3, NFR-4).
 * Capped at `MAX_BRIEF_FILES` (NFR-5) with a `… and N more files` tail so the
 * model is not left to assume it saw the whole PR. Modelled on
 * `reviews/intent-inputs.ts#renderFileList`, with the brief's own cap.
 */
export function renderBriefFileList(diff: UnifiedDiff): string {
  const files = diff.files.slice(0, MAX_BRIEF_FILES);
  const lines = files.map((f) => {
    const headers = f.hunks
      .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
      .join(' ');
    return `${f.path} (+${f.additions}/-${f.deletions})${headers ? ` ${headers}` : ''}`;
  });
  const remaining = diff.files.length - files.length;
  if (remaining > 0) lines.push(`… and ${remaining} more files`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reference validation (AC-20…AC-26)
// ---------------------------------------------------------------------------

/** One line index per file: the set of new-side line numbers covered by a hunk. */
export type LineIndex = Map<string, Set<number>>;

/**
 * Build a per-file line index from the diff's hunks, the same coverage test
 * `reviewer-core#buildLineIndex` applies to findings — re-derived locally
 * (not imported) because `helpers.ts` may import only `@devdigest/shared`
 * types and `./constants.js`.
 */
export function buildBriefLineIndex(diff: UnifiedDiff): LineIndex {
  const idx: LineIndex = new Map();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

export interface RiskLike {
  file_refs: string[];
}

export interface ReviewFocusLike {
  file: string;
  line: number | null;
}

export interface RejectedEntry {
  entry: string;
  reason: string;
}

export interface ValidateReferencesInput<TRisk extends RiskLike, TFocus extends ReviewFocusLike> {
  risks: TRisk[];
  reviewFocus: TFocus[];
}

export interface ValidateReferencesContext {
  /** Every file path present in the brief's own input data. */
  filePaths: Set<string>;
  /** Every endpoint present in the brief's own input data. */
  endpoints: Set<string>;
  lineIndex: LineIndex;
}

export interface ValidateReferencesResult<TRisk extends RiskLike, TFocus extends ReviewFocusLike> {
  risks: TRisk[];
  reviewFocus: TFocus[];
  rejected: RejectedEntry[];
}

/**
 * AC-20/AC-21: accept a risk or review-focus entry only when every file (and,
 * for risks, endpoint reference embedded in `file_refs`) it names is present
 * in the brief's own input data. AC-22/AC-23: drop the WHOLE entry when any
 * reference is unknown, and record which entry and why — never partially
 * keep it. AC-25: an entry naming a real file but a line outside every hunk
 * is KEPT with `line: null`, never dropped and never linked to an unverified
 * coordinate. Caps (MAX_BRIEF_RISKS/MAX_BRIEF_FOCUS) are the caller's
 * responsibility, applied AFTER this validation (NFR-8) — this function does
 * not truncate.
 */
export function validateReferences<TRisk extends RiskLike, TFocus extends ReviewFocusLike>(
  raw: ValidateReferencesInput<TRisk, TFocus>,
  ctx: ValidateReferencesContext,
): ValidateReferencesResult<TRisk, TFocus> {
  const rejected: RejectedEntry[] = [];

  function refKnown(ref: string): boolean {
    return ctx.filePaths.has(ref) || ctx.endpoints.has(ref);
  }

  const risks: TRisk[] = [];
  for (const risk of raw.risks) {
    const unknown = risk.file_refs.find((ref) => !refKnown(ref));
    if (unknown !== undefined) {
      rejected.push({ entry: JSON.stringify(risk), reason: `references unknown file or endpoint "${unknown}"` });
      continue;
    }
    risks.push(risk);
  }

  const reviewFocus: TFocus[] = [];
  for (const entry of raw.reviewFocus) {
    if (!ctx.filePaths.has(entry.file)) {
      rejected.push({ entry: JSON.stringify(entry), reason: `references unknown file "${entry.file}"` });
      continue;
    }
    if (entry.line != null) {
      const covered = ctx.lineIndex.get(entry.file)?.has(entry.line) ?? false;
      if (!covered) {
        reviewFocus.push({ ...entry, line: null });
        continue;
      }
    }
    reviewFocus.push(entry);
  }

  return { risks, reviewFocus, rejected };
}

// ---------------------------------------------------------------------------
// Input budget (NFR-24): truncate by dropping whole sections, never reject
// ---------------------------------------------------------------------------

/**
 * A single named section of the assembled brief input. `label` identifies the
 * section for `BriefProvenance.dropped_sections` — it is NOT rendered into the
 * model input itself (`text` already carries its own `### Heading`).
 */
export interface BriefSection {
  label: string;
  text: string;
}

/** Highest priority (kept longest) first. Mirrors the assembly order in
 *  `service.ts#doGenerate`. Documents are NOT listed here — the caller passes
 *  each selected document as its own section, in the SAME rank order
 *  `applyDocLimits` produced, so per-document drops still take the lowest-
 *  ranked document first. */
export const BRIEF_SECTION_PRIORITY = [
  'changed-files',
  'derived-intent',
  'blast-radius',
  'pr-title-body',
  'linked-issue',
] as const;

export interface EnforceInputBudgetResult {
  /** Sections kept, in their ORIGINAL order — never reordered, only trimmed
   *  from the tail of the priority list. */
  kept: BriefSection[];
  /** Labels of every section dropped to fit the budget, in the order dropped
   *  (lowest priority first) — recorded verbatim into
   *  `BriefProvenance.dropped_sections`. */
  droppedSections: string[];
}

/**
 * NFR-24: enforce `MAX_BRIEF_INPUT_TOKENS` on the assembled brief input by
 * dropping WHOLE sections from the tail of a fixed priority order — never by
 * truncating a section's text, and never by rejecting the request. A brief
 * is always generated.
 *
 * Priority, highest first (dropped LAST): changed-file list, derived intent,
 * blast radius, PR title/body, linked issue, project documents (each document
 * section is its own lowest-priority entry, dropped lowest-ranked first —
 * callers append document sections after `linked-issue` in the SAME order
 * `applyDocLimits` kept them). The changed-file list and blast radius are
 * DevDigest's own computed data, which AC-20…AC-23's reference validation
 * checks against, so they are the last thing this function will drop.
 *
 * `countTokens` is the injected `Tokenizer.count` (or an equivalent estimate
 * in tests) — this function stays pure by taking it as a parameter, never
 * importing a port. The budget is measured on sections joined the same way
 * the caller will join them for the model (`\n\n`-separated), so the
 * recorded drop always corresponds to the actual input sent.
 */
export function enforceInputBudget(
  sections: BriefSection[],
  countTokens: (text: string) => number,
  maxTokens: number = MAX_BRIEF_INPUT_TOKENS,
): EnforceInputBudgetResult {
  const droppedSections: string[] = [];
  let kept = sections;

  while (kept.length > 1 && countTokens(kept.map((s) => s.text).join('\n\n')) > maxTokens) {
    const dropped = kept[kept.length - 1];
    if (!dropped) break;
    droppedSections.push(dropped.label);
    kept = kept.slice(0, -1);
  }

  return { kept, droppedSections };
}
