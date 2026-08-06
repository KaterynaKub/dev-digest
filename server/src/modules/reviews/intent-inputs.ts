/**
 * Pure input assembly + block rendering for the intent classifier (layer 2 —
 * Domain Services). Every export here is a pure function: no `await`, no port
 * calls, no I/O. Inputs are already-fetched values (strings); outputs are
 * strings or parsed arrays. Imports only `@devdigest/shared` types and
 * `./constants.js` — never a port, never `db/**`, never an adapter.
 */
import type { Intent, UnifiedDiff } from '@devdigest/shared';
import {
  ISSUE_REF_PATTERN,
  MAX_INTENT_FILES,
  MAX_INTENT_LINKS,
  SPEC_PATH_PATTERN,
} from './constants.js';

/** Repo-relative issue numbers referenced in `body` (dedup, capped at 3). Mirrors octokit.ts#resolveLinkedIssue's regex. */
export function parseIssueRefs(body: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  // Reset lastIndex — ISSUE_REF_PATTERN is a shared module-level /g regex.
  ISSUE_REF_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ISSUE_REF_PATTERN.exec(body)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Repo-relative `.md` paths under specs/docs, or *.spec.md, referenced in
 * `text` (capped at 3). Rejects `..` and a leading `/` — a path-traversal
 * guard BEFORE the caller ever reaches `git.readFile`.
 */
export function parseSpecPaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Look for path-shaped tokens (no whitespace/quotes/brackets) ending in .md.
  const tokenPattern = /[^\s"'()<>[\]]+\.md/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenPattern.exec(text)) !== null) {
    const candidate = m[0];
    if (candidate.includes('..') || candidate.startsWith('/')) continue;
    if (!SPEC_PATH_PATTERN.test(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * `https://` URLs in `text` that are not GitHub issue/PR links (those go
 * through `getIssue`/parseIssueRefs instead), deduped, capped at
 * `MAX_INTENT_LINKS`. `http://` URLs are collected too — ONLY so they can be
 * reported as `missing_context` ("insecure scheme"); they are never fetched.
 */
export function parseExternalLinks(text: string): { url: string; scheme: 'https' | 'http' }[] {
  const urlPattern = /https?:\/\/[^\s"'()<>[\]]+/gi;
  const out: { url: string; scheme: 'https' | 'http' }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = urlPattern.exec(text)) !== null) {
    let raw = m[0];
    // Trim common trailing punctuation that regex URL matching tends to over-capture.
    raw = raw.replace(/[),.;:!?]+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (/(^|\.)github\.com$/i.test(parsed.hostname) && /\/(issues|pull)\//.test(parsed.pathname)) {
      continue; // GitHub issue/PR links are resolved via getIssue, not fetched as external links.
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push({ url: raw, scheme: parsed.protocol === 'https:' ? 'https' : 'http' });
    if (out.length >= MAX_INTENT_LINKS * 4) break; // generous cap before final MAX_INTENT_LINKS slice below
  }
  return out.slice(0, MAX_INTENT_LINKS);
}

// `sanitiseHtml` lives in `../../adapters/http/html-sanitize.js` (pure,
// dependency-free), NOT here — it runs inside the SafeHttpFetcher adapter
// (constraint 9h) so a fetched document is already sanitised before it ever
// reaches this module. `intent-inputs.ts` cannot import from `adapters/**`
// (dependency-cruiser's `adapters-know-no-modules` rule is the mirror of that
// same boundary), so the two pure files stay siblings rather than one
// importing the other.

/**
 * One line per changed file: `path (+A/-D) @@ -a,b +c,d @@ …` built from
 * `hunks[]`. NO line content — only path + hunk headers. Capped at
 * `MAX_INTENT_FILES` with a `… and N more files` tail.
 */
export function renderFileList(diff: UnifiedDiff): string {
  const files = diff.files.slice(0, MAX_INTENT_FILES);
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

/**
 * The markdown block the reviewer prompt receives. Returns `''` when there is
 * nothing meaningful, so the caller omits the whole section rather than
 * rendering an empty one (reviewer-core/CLAUDE.md: "Empty prompt slots omit
 * their whole section").
 */
export function renderIntentBlock(intent: Intent): string {
  const parts: string[] = [];
  if (intent.intent.trim().length > 0) parts.push(`Intent: ${intent.intent.trim()}`);
  if (intent.in_scope.length > 0) {
    parts.push(`In scope:\n${intent.in_scope.map((s) => `- ${s}`).join('\n')}`);
  }
  if (intent.out_of_scope.length > 0) {
    parts.push(`Out of scope:\n${intent.out_of_scope.map((s) => `- ${s}`).join('\n')}`);
  }
  if (intent.confidence != null) {
    parts.push(`Confidence: ${Math.round(intent.confidence * 100)}%`);
  }
  if (intent.missing_context && intent.missing_context.length > 0) {
    parts.push(`Missing context:\n${intent.missing_context.map((s) => `- ${s}`).join('\n')}`);
  }
  if (parts.length === 0) return '';
  return parts.join('\n\n');
}

/** `Math.ceil(chars / 4)` — a rough estimate, NOT a real tokenizer, for the observability requirement only. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
