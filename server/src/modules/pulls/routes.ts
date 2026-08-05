import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PrMeta, PrDetail, GitHubClient, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { deriveReviewStatus, foldCycleCost } from './status.js';
import {
  buildPrFindings,
  selectCycleReviewIds,
  type CycleReviewRow,
  type FindingSummaryRow,
} from './findings-summary.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      app.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // The latest review CYCLE drives BOTH the COST and the FINDINGS column. A
    // "cycle" is every finished run that reviewed the commit the PR was last
    // reviewed at — hence the join on head_sha = last_reviewed_sha — i.e. all
    // reviewers of the last trigger. Runs recorded before head_sha was tracked
    // are NULL there, match nothing, and correctly surface as "—" / fall back
    // to the newest single review.
    //
    // Fetched once and shared: a cost that covers three reviewers next to
    // findings from only one would read as a bug.
    const prIds = rows.map((r) => r.id);
    const costByPr = new Map<string, ReturnType<typeof foldCycleCost>>();
    const cycleRunIdsByPr = new Map<string, Set<string>>();
    if (prIds.length > 0) {
      const cycleRuns = await container.db
        .select({
          id: t.agentRuns.id,
          prId: t.agentRuns.prId,
          costUsd: t.agentRuns.costUsd,
          costSource: t.agentRuns.costSource,
        })
        .from(t.agentRuns)
        .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.agentRuns.prId))
        .where(
          and(
            inArray(t.agentRuns.prId, prIds),
            eq(t.agentRuns.status, 'done'),
            eq(t.agentRuns.headSha, t.pullRequests.lastReviewedSha),
          ),
        );
      const runsByPr = new Map<string, { costUsd: number | null; costSource: string | null }[]>();
      for (const row of cycleRuns) {
        if (!row.prId) continue;
        const bucket = runsByPr.get(row.prId) ?? [];
        bucket.push({ costUsd: row.costUsd, costSource: row.costSource });
        runsByPr.set(row.prId, bucket);
        const ids = cycleRunIdsByPr.get(row.prId) ?? new Set<string>();
        ids.add(row.id);
        cycleRunIdsByPr.set(row.prId, ids);
      }
      for (const [prId, runs] of runsByPr) costByPr.set(prId, foldCycleCost(runs));
    }

    // SCORE + FINDINGS per PR. Computed on read from reviews (no FK denorm);
    // the list is small, so two IN-queries + JS grouping are cheap.
    //
    // SCORE stays the LATEST review's — it is a single 0-100 verdict, and
    // averaging across reviewers would invent a number no agent produced.
    // FINDINGS, being a union, spans the whole cycle.
    //
    // The findings breakdown ships EAGERLY (rather than lazily on hover) so the
    // column's hover panel opens with zero network work. To keep that
    // affordable the preview is capped and rationales truncated — see
    // ./findings-summary.js.
    const latestScoreByPr = new Map<string, number | null>();
    const reviewIdsByPr = new Map<string, string[]>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({
          id: t.reviews.id,
          prId: t.reviews.prId,
          runId: t.reviews.runId,
          score: t.reviews.score,
          createdAt: t.reviews.createdAt,
        })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      const byPr = new Map<string, CycleReviewRow[]>();
      for (const rv of reviewRows) {
        // Rows are newest-first → first seen per PR is the latest review.
        if (!latestScoreByPr.has(rv.prId)) latestScoreByPr.set(rv.prId, rv.score);
        const bucket = byPr.get(rv.prId);
        if (bucket) bucket.push(rv);
        else byPr.set(rv.prId, [rv]);
      }
      for (const [prId, reviews] of byPr) {
        reviewIdsByPr.set(
          prId,
          selectCycleReviewIds(reviews, cycleRunIdsByPr.get(prId) ?? new Set()),
        );
      }
    }

    // Findings for every review in each PR's cycle. The explicit column list
    // omits `suggestion` and `trifecta_components` — the two fat columns —
    // which is where most of the payload saving comes from.
    const cycleReviewIds = [...reviewIdsByPr.values()].flat();
    const findingsByReview = new Map<string, FindingSummaryRow[]>();
    if (cycleReviewIds.length > 0) {
      const findingRows = await container.db
        .select({
          id: t.findings.id,
          reviewId: t.findings.reviewId,
          severity: t.findings.severity,
          category: t.findings.category,
          title: t.findings.title,
          file: t.findings.file,
          startLine: t.findings.startLine,
          endLine: t.findings.endLine,
          rationale: t.findings.rationale,
          confidence: t.findings.confidence,
          dismissedAt: t.findings.dismissedAt,
        })
        .from(t.findings)
        .where(inArray(t.findings.reviewId, cycleReviewIds));
      for (const f of findingRows) {
        const bucket = findingsByReview.get(f.reviewId);
        if (bucket) bucket.push(f);
        else findingsByReview.set(f.reviewId, [f]);
      }
    }

    const now = Date.now();
    return rows.map((r) => {
      const cycleReviews = reviewIdsByPr.get(r.id);
      const cost = costByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: latestScoreByPr.get(r.id) ?? null,
        cost_usd: cost?.usd ?? null,
        cost_source: cost?.source ?? null,
        // Union of every reviewer in the cycle. null (not an empty roll-up)
        // when the PR has never been reviewed, so the UI's "—" case matches the
        // existing `score == null` convention.
        findings: cycleReviews?.length
          ? buildPrFindings(cycleReviews.flatMap((id) => findingsByReview.get(id) ?? []))
          : null,
      };
    });
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      app.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch (err) {
        app.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
        return [];
      }
      try {
        return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
      } catch (err) {
        app.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch {
        throw new AppError(
          'github_unavailable',
          'Connect a GitHub token to post comments.',
          400,
        );
      }
      try {
        return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs (422).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
        throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );

  // Activity summary for the repo overview: per-PR review + finding counts,
  // newest PR first. Powers the "N reviews · M findings" row on each pull
  // request in the repo dashboard.
  app.get('/repos/:id/activity', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    const prs = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id))
      .orderBy(desc(t.pullRequests.number));

    const summary = [];
    for (const pr of prs) {
      const reviews = await container.db
        .select()
        .from(t.reviews)
        .where(eq(t.reviews.prId, pr.id));

      let findings = 0;
      for (const review of reviews) {
        const rows = await container.db
          .select()
          .from(t.findings)
          .where(eq(t.findings.reviewId, review.id));
        findings += rows.length;
      }

      summary.push({ number: pr.number, title: pr.title, reviews: reviews.length, findings });
    }

    return summary;
  });
}
