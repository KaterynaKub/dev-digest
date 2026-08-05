import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, integer, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One convention-extraction run over a repo. Backs the "Detected from N sample
 * files · last scan 1h ago" subtitle, and records the verification gate's
 * outcome: `candidatesRaw - candidatesKept` is how many candidates the model
 * produced that could not be grounded in the sampled files.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Files actually READ (not requested) — the subtitle reports this. */
    sampleCount: integer('sample_count').notNull(),
    /** Of which were config files (eslint/tsconfig/prettier/…). */
    configCount: integer('config_count').notNull(),
    candidatesRaw: integer('candidates_raw').notNull(),
    candidatesKept: integer('candidates_kept').notNull(),
    /** The model actually used, e.g. "deepseek/deepseek-v4-flash". */
    model: text('model').notNull(),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.workspaceId, t.repoId) }),
);

/**
 * A code-verified convention candidate. Every row here survived the mechanical
 * evidence gate, which is why `evidencePath`/`evidenceSnippet`/`confidence` are
 * NOT NULL: an unverified candidate is never persisted at all.
 *
 * `status` is a three-state enum rather than a boolean because the UI must
 * distinguish "explicitly rejected" from "not looked at yet" — a boolean cannot
 * express that, and "Reject all" would resurrect on reload.
 *
 * There is deliberately NO unique constraint on (repoId, rule): the model
 * paraphrases, so two scans yield textually different rows for one semantic
 * rule. Dedup is a fuzzy, inspectable code path in the module's helpers.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id')
      .notNull()
      .references(() => conventionScans.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path').notNull(),
    evidenceStartLine: integer('evidence_start_line').notNull(),
    evidenceEndLine: integer('evidence_end_line').notNull(),
    /** Sliced off disk by the verifier — never the model's own text. */
    evidenceSnippet: text('evidence_snippet').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    /** A human edited `rule`/`category`; makes the row survive a re-scan. */
    edited: boolean('edited').notNull().default(false),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('conventions_repo_idx').on(t.workspaceId, t.repoId) }),
);
