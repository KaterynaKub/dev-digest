/**
 * Pure helpers for the MCP tools module (side-effect free; operate purely on
 * their arguments — no DB / network / `this`).
 *
 * Constraint 7 (`specs/0006-mcp-server.md`): no Drizzle row type (`AgentRow`,
 * `ReviewRow`, `FindingRow`, `PullRow`) may appear here. Every mapper below
 * takes a LOCAL structural interface — only the fields it actually reads —
 * so a row happens to satisfy the parameter type without this file importing
 * `db/**` or any module's `repository.ts` (constraint 4).
 */
import type { CiFailOn } from '@devdigest/shared';
import { RATIONALE_MAX_CHARS } from './constants.js';

// ---------------------------------------------------------------------------
// DTOs — the module's own contracts. NOT `ReviewDtoFinding` (evidence,
// trifecta_components, review_id, timestamps) and NOT `AgentRow` — see
// constraint 7 and principle #3 (stisla structured response).
// ---------------------------------------------------------------------------

export interface McpAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
}

export interface McpFinding {
  severity: string;
  category: string;
  title: string;
  file: string;
  lines: string;
  rationale: string;
}

export type McpVerdict = 'blocked' | 'concerns' | 'clean';

// ---------------------------------------------------------------------------
// Mappers — local structural interfaces, no Drizzle row types.
// ---------------------------------------------------------------------------

/** The subset of an agent row `toMcpAgent` reads. */
export interface AgentLike {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
}

/** Maps an agent into the 5-field MCP DTO — drops system_prompt, output_schema,
 *  timestamps and workspace_id (principle #3 + constraint 7). */
export function toMcpAgent(row: AgentLike): McpAgent {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    enabled: row.enabled,
  };
}

/** The subset of a finding row `compactFinding` reads. */
export interface FindingLike {
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
}

/** Maps a finding into exactly 6 fields — the "compact" contract MCP clients
 *  see. `rationale` truncates to `RATIONALE_MAX_CHARS` with a `…` suffix. */
export function compactFinding(f: FindingLike): McpFinding {
  const rationale =
    f.rationale.length > RATIONALE_MAX_CHARS
      ? `${f.rationale.slice(0, RATIONALE_MAX_CHARS)}…`
      : f.rationale;
  return {
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    lines: `${f.start_line}-${f.end_line}`,
    rationale,
  };
}

/**
 * Severity rank (higher = worse) — mirrors `reviewer-core`'s `SEV_RANK`
 * (`output/to-review.ts`), duplicated here because that table is not part of
 * the package's public `index.ts` export and this file must stay a leaf
 * (no reach into reviewer-core's internals).
 */
const SEV_RANK: Record<string, number> = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 };

/** Minimum severity rank that trips the gate, per policy — mirrors `FAIL_ON_MIN_RANK`. */
const FAIL_ON_MIN_RANK: Record<CiFailOn, number> = {
  never: Number.POSITIVE_INFINITY,
  critical: 3,
  warning: 2,
  any: 1,
};

/**
 * Deterministic verdict from finding severities against the agent's CI gate —
 * the SAME rule as `reviews/CLAUDE.md` and `countBlockers`: never the model's
 * self-reported `verdict`. `'blocked'` when the gate is tripped by ANY
 * finding; `'concerns'` when there are findings but none trip the gate;
 * `'clean'` when there are no findings at all.
 */
export function deriveVerdict(findings: FindingLike[], agentCiFailOn: CiFailOn): McpVerdict {
  if (findings.length === 0) return 'clean';
  const min = FAIL_ON_MIN_RANK[agentCiFailOn];
  const blocked = findings.some((f) => (SEV_RANK[f.severity] ?? 0) >= min);
  return blocked ? 'blocked' : 'concerns';
}

export interface TruncatedFindings {
  shown: McpFinding[];
  total: number;
  note?: string;
}

/**
 * Cap a findings list at `limit`, attaching a "showed N of M" note only when
 * the list was actually truncated (principle #3).
 */
export function truncateFindings(list: McpFinding[], limit: number): TruncatedFindings {
  const total = list.length;
  if (total <= limit) return { shown: list, total };
  return {
    shown: list.slice(0, limit),
    total,
    note: `Showing ${limit} of ${total} findings — narrow the filter with the severity parameter.`,
  };
}

// ---------------------------------------------------------------------------
// repo normalization
// ---------------------------------------------------------------------------

const REPO_URL_PREFIX = /^(?:https?:\/\/)?github\.com\//i;
const OWNER_NAME_RE = /^[^/\s]+\/[^/\s]+$/;

/**
 * Normalize a model-supplied `repo` argument to `"owner/name"`. Accepts
 * `"owner/name"`, `"https://github.com/owner/name"`, `"github.com/owner/name"`,
 * and URLs with a trailing path (`/pull/42`), `.git` suffix, or trailing
 * slash. Pure — no network. Returns `undefined` for anything that does not
 * resolve to exactly one owner and one repo name (e.g. `"payments-api"` with
 * no owner, or an empty string) — the caller maps `undefined` to the
 * "unrecognized format" tool error (Step 6).
 */
export function normalizeRepo(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  let rest = trimmed.replace(REPO_URL_PREFIX, '');
  // Strip a leading slash left behind when the input had no scheme, e.g. "/owner/name".
  rest = rest.replace(/^\/+/, '');
  // Drop everything after "owner/name" (e.g. "/pull/42", extra path segments).
  const segments = rest.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return undefined;
  let [owner, name] = segments;
  if (!owner || !name) return undefined;
  name = name.replace(/\.git$/i, '');
  if (!owner || !name) return undefined;

  const candidate = `${owner}/${name}`;
  return OWNER_NAME_RE.test(candidate) ? candidate : undefined;
}
