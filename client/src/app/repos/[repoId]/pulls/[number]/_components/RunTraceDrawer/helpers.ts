import type { LogLine } from "@devdigest/ui";
import type { RunTrace, ContextDocRead } from "@devdigest/shared";

/** One `specs_read` entry, flattened so the renderer never branches on shape. */
export interface SpecReadView {
  path: string;
  tokens: number | null;
  status: ContextDocRead["status"] | null;
  origin: ContextDocRead["origin"] | null;
  skillName: string | null;
}

/**
 * Normalize `specs_read` across BOTH persisted shapes.
 *
 * Traces written before the project-context feature hold plain `string` paths;
 * newer ones hold `ContextDocRead` objects. Nothing on the server side parses a
 * trace — `run.repo.ts` casts the raw jsonb, the route declares no response
 * schema, and `hooks/trace.ts` casts too — so a historical trace reaches this
 * renderer as bare strings. This function is the ONLY thing standing between
 * that and a broken drawer.
 *
 * A legacy entry yields nulls rather than placeholder values: the renderer must
 * omit the badges entirely, never show "unknown" for facts the old trace simply
 * never recorded.
 */
export function normalizeSpecsRead(raw: RunTrace["specs_read"]): SpecReadView[] {
  return raw.map((entry) =>
    typeof entry === "string"
      ? { path: entry, tokens: null, status: null, origin: null, skillName: null }
      : {
          path: entry.path,
          tokens: entry.tokens,
          status: entry.status,
          origin: entry.origin,
          skillName: entry.skill_name ?? null,
        },
  );
}

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}
