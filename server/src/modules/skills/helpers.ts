import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { DEFAULT_SKILL_TYPE, SKILL_ENTRY_CANDIDATES } from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the
 * body-only version-bump rule, the markdown/frontmatter parser, and archive
 * entry selection. NO imports from ./repository.js: that cycle is exactly what
 * bit `modules/agents` (see its `helpers.ts` ⇄ `repository.ts` note and the
 * `no-circular` warning in `.dependency-cruiser.cjs`). The row shape a caller
 * needs is declared structurally below instead.
 */

/** Structural shape of a persisted `skills` row — enough for `toSkillDto`.
 *  Deliberately NOT imported from `./repository.js` (see module comment). */
export interface SkillRowLike {
  id: string;
  name: string;
  description: string;
  type: string;
  source: string;
  body: string;
  enabled: boolean;
  version: number;
  evidenceFiles?: string[] | null;
}

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRowLike): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Fields a skill update patch may carry. Only `body` affects versioning. */
export interface SkillBodyChangePatch {
  body?: string;
}

/**
 * True when a patch changes `body` relative to the existing row. This is the
 * ENTIRE version-bump rule for skills — narrower than agents (which bump on
 * any config change): renaming/retyping/enabling a skill never bumps its
 * version, because `body` is the only thing a past review's prompt actually
 * captured.
 */
export function isBodyChange(
  existing: Pick<SkillRowLike, 'body'>,
  patch: SkillBodyChangePatch,
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

// ---------------------------------------------------------------- slugify --

/** Lowercase, hyphenated slug for a skill name — used as the `wrapUntrusted`
 *  label (`skill-${slug}`) by the run-executor (a later wave), not here. */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill'
  );
}

// ------------------------------------------------------- parseSkillMarkdown

export interface ParsedSkill {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

const KNOWN_SKILL_TYPES: readonly string[] = ['rubric', 'convention', 'security', 'custom'];

/**
 * Extract a skill's "core" (name/description/type/body) from raw markdown
 * text. First match wins, in priority order:
 *
 *  1. YAML frontmatter (`---` at offset 0) — the convention this very repo
 *     uses for its own skills (see `.claude/skills/*\/SKILL.md`). Reads only
 *     `name`/`description`/`type` as plain scalars via a small hand-rolled
 *     reader (NOT js-yaml — no anchors/aliases/tag attack surface on
 *     untrusted uploads). The frontmatter block is cut from the returned body.
 *  2. First `# H1` line → name; first non-empty paragraph after it →
 *     description.
 *  3. Fallback → name = filename (no extension), description = first 200
 *     chars of the body, type = 'custom'.
 *
 * Throws when the resulting description would be empty/whitespace-only (the
 * DB column is NOT NULL) — the caller (service) turns that into a 422.
 */
export function parseSkillMarkdown(text: string, fallbackName?: string): ParsedSkill {
  const { frontmatter, rest } = extractFrontmatter(text);

  let name: string | undefined = frontmatter?.name;
  let description: string | undefined = frontmatter?.description;
  let type: SkillType = normalizeType(frontmatter?.type);
  let body = rest;

  if (!name || !description) {
    const h1 = extractH1AndParagraph(rest);
    name ??= h1.name;
    description ??= h1.description;
  }

  if (!name) name = (fallbackName ?? 'Untitled skill').replace(/\.[^./\\]+$/, '');
  if (!description) description = rest.trim().slice(0, 200);

  if (!description || description.trim().length === 0) {
    throw new Error('Could not extract a description from the skill body');
  }

  body = body.trim();

  return { name: name.trim(), description: description.trim(), type, body };
}

function normalizeType(value: string | undefined): SkillType {
  if (value && KNOWN_SKILL_TYPES.includes(value)) return value as SkillType;
  return DEFAULT_SKILL_TYPE as SkillType;
}

/**
 * Cut a leading `---\n…\n---` frontmatter block (must start at offset 0) and
 * read it as flat YAML SCALARS ONLY: `key: value` lines, optional quotes
 * stripped. No nesting, no lists, no anchors/aliases/tags — those are simply
 * ignored (the key is skipped) rather than causing a parse failure, so a
 * community skill with a richer frontmatter block still degrades gracefully.
 */
function extractFrontmatter(text: string): {
  frontmatter: Record<string, string> | undefined;
  rest: string;
} {
  if (!text.startsWith('---')) return { frontmatter: undefined, rest: text };

  const firstNewline = text.indexOf('\n');
  if (firstNewline === -1) return { frontmatter: undefined, rest: text };
  // Line 1 must be exactly '---' (allow trailing \r).
  if (text.slice(0, firstNewline).trim() !== '---') return { frontmatter: undefined, rest: text };

  const closeMatch = /\n---[ \t]*\r?(\n|$)/.exec(text.slice(firstNewline));
  if (!closeMatch) return { frontmatter: undefined, rest: text };

  const blockEnd = firstNewline + closeMatch.index;
  const closeLineEnd = firstNewline + closeMatch.index + closeMatch[0].length;
  const rawBlock = text.slice(firstNewline + 1, blockEnd);
  const rest = text.slice(closeLineEnd);

  const frontmatter: Record<string, string> = {};
  for (const line of rawBlock.split('\n')) {
    const scalar = parseScalarLine(line);
    if (scalar) frontmatter[scalar.key] = scalar.value;
  }
  return { frontmatter, rest };
}

/** Parse one `key: value` line. Returns undefined for anything that isn't a
 *  flat scalar assignment (nested maps/lists, comments, blank lines, anchors
 *  `&`/aliases `*`/tags `!!` are all silently skipped, never thrown on). */
function parseScalarLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed.trim() || trimmed.trim().startsWith('#')) return undefined;
  // Reject obvious non-scalar YAML: list items, nested block indicators.
  if (/^\s*-/.test(trimmed)) return undefined;
  const colon = trimmed.indexOf(':');
  if (colon === -1) return undefined;
  const key = trimmed.slice(0, colon).trim();
  if (!key || /[&*!]/.test(key)) return undefined;
  let value = trimmed.slice(colon + 1).trim();
  if (!value) return undefined;
  if (/^[&*!]/.test(value)) return undefined; // anchors/aliases/tags — skip, don't parse
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/** First `# H1` line → name; first non-empty paragraph after it → description. */
function extractH1AndParagraph(text: string): { name?: string; description?: string } {
  const lines = text.split('\n');
  const h1Index = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Index === -1) return {};
  const name = lines[h1Index]!.replace(/^#\s+/, '').trim();

  for (let i = h1Index + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith('#')) break; // next heading, no paragraph found
    return { name, description: line };
  }
  return { name, description: undefined };
}

// ------------------------------------------------------- archive selection

/** Structural metadata for one archive central-directory entry — enough to
 *  pick a skill entry WITHOUT ever opening a read stream. The actual yauzl
 *  streaming (and the "never openReadStream a non-.md entry" guarantee) lives
 *  in routes.ts, which has the real yauzl Entry objects; this stays pure. */
export interface ArchiveEntryMeta {
  /** Entry path as stored in the archive, e.g. "skills/test-quality/SKILL.md". */
  fileName: string;
  uncompressedSize: number;
  /** True for a symlink entry (detected from the upper 16 bits of the external
   *  file attributes, S_IFLNK) — always rejected, never selected. */
  isSymlink: boolean;
}

/**
 * Pick which `.md` entry to use as "the" skill body, given the archive's
 * central directory. Priority: root `SKILL.md` > `<dir>/SKILL.md` (any
 * nesting depth) > root `README.md` > the largest remaining `.md` entry. Symlinks and
 * non-`.md` entries are never candidates. Path-traversal-shaped entries
 * (`..`, absolute, backslash, NUL) are rejected outright — zip-slip is
 * structurally impossible here (nothing is written to disk), but rejecting
 * these keeps the intent legible and defends any future code path that might
 * write one out.
 *
 * Returns undefined when no eligible `.md` entry exists (caller → 422).
 */
export function selectArchiveEntry(entries: ArchiveEntryMeta[]): ArchiveEntryMeta | undefined {
  const eligible = entries.filter(
    (e) => !e.isSymlink && isMarkdownEntry(e.fileName) && !isUnsafePath(e.fileName),
  );
  if (eligible.length === 0) return undefined;

  const rootSkill = eligible.find((e) => e.fileName === 'SKILL.md');
  if (rootSkill) return rootSkill;

  const nestedSkill = eligible.find((e) => /\/SKILL\.md$/.test(e.fileName));
  if (nestedSkill) return nestedSkill;

  const rootReadme = eligible.find((e) => e.fileName === 'README.md');
  if (rootReadme) return rootReadme;

  return eligible.reduce((largest, e) =>
    e.uncompressedSize > largest.uncompressedSize ? e : largest,
  );
}

function isMarkdownEntry(fileName: string): boolean {
  return /\.md$/i.test(fileName) && !fileName.endsWith('/');
}

/** Reject entries whose path is traversal-shaped, absolute, or contains a NUL
 *  byte / backslash. Kept even though nothing is ever written to disk (see
 *  the doc comment above `selectArchiveEntry`). */
function isUnsafePath(fileName: string): boolean {
  if (fileName.includes('\0')) return true;
  if (fileName.includes('\\')) return true;
  if (fileName.startsWith('/')) return true;
  if (/^[a-zA-Z]:/.test(fileName)) return true; // Windows drive-letter absolute
  const parts = fileName.split('/');
  return parts.some((p) => p === '..');
}
