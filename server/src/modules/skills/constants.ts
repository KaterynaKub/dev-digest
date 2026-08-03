/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default `type` when parsing can't infer one (unknown frontmatter value, H1
 *  fallback, or filename fallback). */
export const DEFAULT_SKILL_TYPE = 'custom';

/** Cap on a skill's stored body — a runaway import shouldn't blow the prompt
 *  budget or the DB column silently. ~64k chars. */
export const MAX_SKILL_BODY_CHARS = 64_000;

// ---- Archive (.zip) import limits ----------------------------------------

/** Request-body cap for an uploaded archive (multipart `limits.fileSize`).
 *  Rejected at the transport layer before any parsing happens. */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Max number of central-directory entries an archive may contain. An archive
 *  with tens of thousands of entries is a DoS vector, not a plausible skill. */
export const MAX_ARCHIVE_ENTRIES = 200;

/** Max total UNCOMPRESSED bytes across all entries, summed from the central
 *  directory's declared `uncompressedSize` BEFORE any entry stream is opened.
 *  This is what makes the zip-bomb defense cheap: reject before decompressing
 *  a single byte. */
export const MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024; // 8 MB

/** Root-relative entry names tried, in order, before falling back to "largest
 *  .md entry". `<dir>/SKILL.md` (one level down) is tried between the two. */
export const SKILL_ENTRY_CANDIDATES = ['SKILL.md', 'README.md'];
