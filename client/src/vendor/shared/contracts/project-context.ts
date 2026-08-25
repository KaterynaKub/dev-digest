import { z } from 'zod';

/**
 * Project Context contracts (0001a) — discovery of markdown documents under a
 * workspace's configured `context_roots`, their attachment to agents/skills,
 * and the on-demand read/write of one document's content. `context_roots`
 * itself lives in `platform.ts` next to `SettingsKnown`.
 */

/** One discovered document — path, its current attachment count, and the
 *  configured root it matched (also its type label, AC-64). */
export const ContextDoc = z.object({
  path: z.string(),
  attached_count: z.number().int(),
  root: z.string().nullable(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

/**
 * The listing's status line (AC-3, AC-57…AC-63, NFR-19, NFR-22). `count`/
 * `token_sum` are OMITTED (not present, not zero) when the repo has no local
 * clone (AC-6/AC-63); `token_sum` is `null` while still pending (AC-61).
 */
export const ContextStatus = z.object({
  count: z.number().int().nullish(),
  token_sum: z.number().int().nullable().nullish(),
  token_sum_pending: z.boolean(),
  scanned_at: z.string(),
  truncated: z.boolean(),
  fallback_used: z.boolean(),
  cloned: z.boolean(),
});
export type ContextStatus = z.infer<typeof ContextStatus>;

export const ContextListing = z.object({
  docs: z.array(ContextDoc),
  status: ContextStatus,
});
export type ContextListing = z.infer<typeof ContextListing>;

/** One document attached to an agent or skill, in persisted order (AC-52). */
export const ContextAttachment = z.object({
  path: z.string(),
  order: z.number().int(),
  missing: z.boolean(),
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

/** `POST /agents/:id/context-docs` and `POST /skills/:id/context-docs` — a
 *  full-replace of the ordered attachment set (array order IS the order). */
export const SetContextDocsBody = z.object({
  paths: z.array(z.string()).max(20),
});
export type SetContextDocsBody = z.infer<typeof SetContextDocsBody>;
