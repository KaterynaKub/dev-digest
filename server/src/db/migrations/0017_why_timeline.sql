-- 0003 — Why Timeline: widen pr_brief's primary key from (pr_id) alone to
-- (pr_id, head_sha, indexed_sha_key) so a regeneration against a NEW head sha
-- appends a history entry instead of overwriting the previous brief.
--
-- Hand-written, not `db:generate` output: 0016's "table is empty in every
-- environment" assumption no longer holds (a real row can exist), and
-- drizzle-kit renders a PK change as a bare ADD CONSTRAINT (no DROP of the
-- old one, no backfill UPDATE) which would leave `indexed_sha_key` at its
-- default `''` for rows that actually have an index. No dedup step is needed
-- before the PK add: the OLD `pr_id` PK already guarantees at most one row
-- per PR, so no duplicate (pr_id, head_sha, indexed_sha_key) can exist yet —
-- every pre-existing row is preserved and becomes the first timeline entry
-- for its PR.
ALTER TABLE "pr_brief" ADD COLUMN "indexed_sha_key" text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE "pr_brief" SET "indexed_sha_key" = COALESCE("indexed_sha", '');--> statement-breakpoint
ALTER TABLE "pr_brief" DROP CONSTRAINT "pr_brief_pkey";--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_pkey" PRIMARY KEY ("pr_id", "head_sha", "indexed_sha_key");--> statement-breakpoint
CREATE INDEX "pr_brief_pr_idx" ON "pr_brief" ("pr_id");
