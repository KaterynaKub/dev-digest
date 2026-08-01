/* findings-view.ts — adapt wire findings into the FindingsSeverityRow view model.
   Shared because two surfaces feed the same component from different shapes:
   the PR list sends `FindingSummary` (capped + server-truncated), the PR detail
   timeline sends `FindingRecord` (full findings already in the client cache). */

import type { SeverityFinding, SeverityKey } from "@devdigest/ui";
import { githubBlobUrl } from "./github-urls";

/**
 * Mirrors RATIONALE_PREVIEW_CHARS in @devdigest/shared. Inlined rather than
 * imported: the contracts are Zod modules, so importing this single number
 * pulls zod itself into the client bundle (~14 kB) for a value the browser
 * never validates with. Server-side truncation is authoritative — this is only
 * the fallback for the timeline path, where findings arrive untruncated.
 */
const RATIONALE_PREVIEW_CHARS = 150;

/** Fields both wire shapes share. `severity`/`category` stay loose — the DB columns are text. */
interface FindingLike {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  confidence: number;
  dismissed_at?: string | null;
}

/** Format a line range ("11" when single-line, else "11-15"). */
function lineLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

/** Client-side fallback for rationales the server did not truncate (timeline path). */
function clampRationale(text: string, max = RATIONALE_PREVIEW_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

/**
 * Map findings onto the shared view model, dropping dismissed ones so the
 * timeline matches the PR list (which excludes them server-side).
 */
export function toSeverityFindings(
  findings: FindingLike[],
  repoFullName?: string | null,
  headSha?: string | null,
): SeverityFinding[] {
  return findings
    .filter((f) => !f.dismissed_at)
    .map((f) => ({
      id: f.id,
      severity: f.severity as SeverityKey,
      category: f.category,
      title: f.title,
      file: f.file,
      lineLabel: lineLabel(f.start_line, f.end_line),
      href:
        repoFullName && headSha
          ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
          : undefined,
      confidence: f.confidence,
      rationale: clampRationale(f.rationale),
    }));
}
