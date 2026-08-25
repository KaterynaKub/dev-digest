/**
 * Pure helpers for the project-context module — the containment guard, root
 * matching, path de-duplication, and status-line assembly. NO `fs`, `git`, or
 * `db` here (`helpers-are-pure`) — all filesystem/git access lives in
 * `service.ts`.
 */

/**
 * True when `path` is a safe repo-relative path: no leading `/`, no
 * Windows-absolute prefix (`C:`), no backslash segment, and no `.` or `..`
 * segment anywhere (AC-47, NFR-18). Checked BEFORE any filesystem access, the
 * same shape as `reviews/intent-inputs.ts#parseSpecPaths` and
 * `skills/helpers.ts#isUnsafePath` — but per-segment, since a char-class-only
 * check does not by itself reject `..` (see root `INSIGHTS.md`).
 */
export function isContainedPath(path: string): boolean {
  if (!path || path.length === 0) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false; // Windows drive-letter absolute
  const segments = path.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/**
 * The first configured root under which `path` falls, or `null` when none
 * matches. This is also the document's type label (AC-64) — a custom root
 * such as `adr/` yields its own label with no further configuration. `roots`
 * is checked in the caller's configured order, first match wins.
 */
export function matchRoot(path: string, roots: string[]): string | null {
  for (const root of roots) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (path.startsWith(prefix)) return root;
  }
  return null;
}

/** An entry carrying at least a repo-relative `path`. */
export interface PathKeyed {
  path: string;
}

/**
 * De-duplicate a sequence of path-keyed entries, keeping the FIRST occurrence
 * of each path and discarding later ones (prepares for AC-26's "first
 * position wins" run-time dedup, landed in `0001b`).
 */
export function dedupeByPath<T extends PathKeyed>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}

/** Input to `buildStatusLine` — the raw facts the caller has assembled. */
export interface StatusLineInput {
  /** Repository has never been cloned (AC-6, AC-63): count/tokenSum are omitted entirely. */
  cloned: boolean;
  /** Number of documents in the listing. Ignored when `cloned` is false. */
  count: number;
  /** Summed token estimate across the listing, or `null` while still pending
   *  (AC-61) or when `cloned` is false. */
  tokenSum: number | null;
  /** True while the summed estimate is still being computed (AC-61, NFR-21). */
  pending: boolean;
  /** True when at least one document contributing to the sum used the
   *  character-based fallback (AC-18, AC-60). */
  fallbackUsed: boolean;
  /** True when discovery hit the NFR-5 cap and returned only the first
   *  MAX_LISTED_DOCS by walk order (NFR-19). */
  truncated: boolean;
  /** ISO timestamp the listing was produced (AC-58). */
  scannedAt: string;
}

/** The structured status line the client renders (AC-3, AC-57…AC-63,
 *  NFR-19, NFR-22). Deliberately NOT a formatted string — copy lives in the
 *  client's `messages/`. */
export interface StatusLine {
  /** Document count, or `undefined` when the repo has no local clone (AC-63). */
  count?: number;
  /** Summed token estimate, or `undefined` when no clone (AC-63) or `null`
   *  while the sum is still pending (AC-61). */
  tokenSum?: number | null;
  pending: boolean;
  fallbackUsed: boolean;
  truncated: boolean;
  cloned: boolean;
  scannedAt: string;
}

/**
 * Assemble the status-line structure from the raw facts a caller collected.
 * No formatting, no I/O — a pure projection so every AC-3/AC-57…AC-63 state
 * (empty, no-clone, pending, fallback, truncated) is exercised by a plain
 * unit test.
 */
export function buildStatusLine(input: StatusLineInput): StatusLine {
  if (!input.cloned) {
    return {
      pending: false,
      fallbackUsed: false,
      truncated: false,
      cloned: false,
      scannedAt: input.scannedAt,
    };
  }
  return {
    count: input.count,
    tokenSum: input.pending ? null : input.tokenSum,
    pending: input.pending,
    fallbackUsed: input.fallbackUsed,
    truncated: input.truncated,
    cloned: true,
    scannedAt: input.scannedAt,
  };
}
