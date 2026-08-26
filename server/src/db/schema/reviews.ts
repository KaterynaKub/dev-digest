import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // The PR list endpoint fetches findings by review_id on every poll; without
    // this that's a seq scan of the fastest-growing table in the schema.
    reviewIdx: index('findings_review_idx').on(t.reviewId),
  }),
);

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Nullable (not defaulted): an UNKNOWN confidence must be distinguishable
  // from a confident 0 — same reasoning as agent_runs.costUsd (server/INSIGHTS.md).
  confidence: doublePrecision('confidence'),
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Nullable: no derivation has ever run for this PR yet (row seeded some
  // other way, or pre-dating this column).
  headSha: text('head_sha'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow(),
});

export const prBrief = pgTable(
  'pr_brief',
  {
    // No longer the primary key alone (0003 — Why Timeline): a PR now retains
    // up to `MAX_BRIEF_HISTORY` briefs, one per distinct (head_sha, indexed_sha)
    // it was generated against, so `prId` stays a required FK but the row
    // identity moves to the composite key below.
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    json: jsonb('json').notNull(),
    // Cache key (AC-27): the PR head sha this brief's diff-derived input was
    // assembled from.
    headSha: text('head_sha').notNull(),
    // Cache key (AC-27), continued. Nullable — AC-28's distinct key value: a
    // repository with no index produces a brief keyed by `indexed_sha: null`,
    // which must never be served for a state that later gains one. Every read
    // uses THIS column, never `indexedShaKey`.
    indexedSha: text('indexed_sha'),
    // PK stand-in for `indexedSha` (0003): Postgres forbids NULL in a PRIMARY
    // KEY, so this column normalises the nullable `indexed_sha` to `''` (not a
    // valid sha, so unambiguous) purely to give `onConflictDoUpdate` a single
    // inferable arbiter. Never read for currency — `indexedSha` carries the
    // real semantics (AC-28).
    indexedShaKey: text('indexed_sha_key').notNull().default(''),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prId, t.headSha, t.indexedShaKey] }),
    prIdx: index('pr_brief_pr_idx').on(t.prId),
  }),
);
