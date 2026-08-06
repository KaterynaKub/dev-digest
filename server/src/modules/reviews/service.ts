import type {
  FeatureModelChoice,
  FindingActionKind,
  PrIntentRecord,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import type { RunBus } from '../../platform/sse.js';
// AgentRow comes from the repository that owns it, not from db/rows directly —
// the service layer stays clear of the persistence module.
import type { AgentsRepository, AgentRow } from '../agents/repository.js';
import type { SkillsRepository } from '../skills/repository.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type ReviewRunDeps, type Logger } from './run-executor.js';
import { IntentDeriver } from './intent.js';
import { loadDiff } from './diff-loader.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over the injected runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */

/**
 * Ports this service needs. Injected explicitly — never the whole Container.
 * Extends the executor's ports because it constructs (and forwards to) one.
 */
export interface ReviewDeps extends ReviewRunDeps {
  repo: ReviewRepository;
  agentsRepo: AgentsRepository;
}

/**
 * Wire ReviewDeps from the composition root. Lives here (next to the port it
 * satisfies) so both call sites — the routes and the boot-time reaper — build
 * the same set; only `container.ts` and `app.ts` may call it.
 */
export function reviewDeps(container: {
  reviewRepo: ReviewRepository;
  agentsRepo: AgentsRepository;
  skillsRepo: SkillsRepository;
  git: ReviewRunDeps['git'];
  runBus: RunBus;
  repoIntel: ReviewRunDeps['repoIntel'];
  llm: ReviewRunDeps['llm'];
  github: ReviewRunDeps['github'];
  httpFetcher: ReviewRunDeps['httpFetcher'];
  /**
   * Resolver for the intent classifier's model choice — a workspace override
   * (`getFeatureModelOverride`, NOT `resolveFeatureModel`, so this module's
   * own cheap default survives) or `DEFAULT_INTENT_MODEL`. Built by the
   * caller (`routes.ts` / boot-time reaper in `app.ts`), never derived here,
   * because it needs `getFeatureModelOverride` + `DEFAULT_INTENT_MODEL` which
   * belong to `modules/settings` and `modules/reviews/constants` respectively
   * — this factory stays a plain structural adapter over `Container`.
   */
  intentModel: ReviewRunDeps['intentModel'];
  /** Resolver reading the workspace's `intent_link_allowlist` (see `readLinkAllowlist`). */
  linkAllowlist: ReviewRunDeps['linkAllowlist'];
}): ReviewDeps {
  return {
    repo: container.reviewRepo,
    agentsRepo: container.agentsRepo,
    skillsRepo: container.skillsRepo,
    git: container.git,
    runBus: container.runBus,
    repoIntel: container.repoIntel,
    llm: (provider) => container.llm(provider),
    github: container.github,
    httpFetcher: container.httpFetcher,
    intentModel: container.intentModel,
    linkAllowlist: container.linkAllowlist,
  };
}

export class ReviewService {
  private repo: ReviewRepository;
  private agents: AgentsRepository;
  private executor: ReviewRunExecutor;
  private runBus: RunBus;
  private deps: ReviewDeps;
  private intentDeriver: IntentDeriver;

  constructor(deps: ReviewDeps) {
    this.repo = deps.repo;
    this.agents = deps.agentsRepo;
    this.runBus = deps.runBus;
    this.deps = deps;
    this.executor = new ReviewRunExecutor(deps, this.repo, this.agents);
    this.intentDeriver = new IntentDeriver({
      repo: this.repo,
      git: deps.git,
      github: deps.github,
      llm: deps.llm,
      httpFetcher: deps.httpFetcher,
      linkAllowlist: deps.linkAllowlist,
    });
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        // Pin the commit this run reviews — the cost rollup groups runs by it.
        headSha: pull.headSha,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Intent — GET reads the persisted row only; deriveIntent runs the classifier.
  // ===========================================================================

  /** The persisted intent for a PR, or `null` when none has been derived yet. */
  async getIntent(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId); // workspace scope check
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getIntent(prId);
    if (!stored) return null;
    return { pr_id: prId, ...stored };
  }

  /**
   * Run the classifier and persist the result. Unlike a review run this IS
   * awaited — it is one cheap call, and the UI needs the result to render the
   * INTENT card. `force: true` bypasses the head-sha freshness check.
   */
  async deriveIntent(
    workspaceId: string,
    prId: string,
    model: FeatureModelChoice,
    force: boolean,
  ): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.deps.git, this.repo, workspaceId, pull, repoRow);
    const result = await this.intentDeriver.derive({ workspaceId, pull, repoRow, diff, model, force });
    if (!result) throw new AppError('intent_derivation_failed', 'Could not derive intent for this PR', 502);
    // Re-read the persisted row for its true head_sha/derived_at rather than
    // hand-computing them here — correct for BOTH outcomes: a fresh derive
    // (upsertIntent just wrote pull.headSha + now()) and a reused stored
    // intent (head_sha/derived_at reflect when it was ACTUALLY derived, not
    // this call).
    const stored = await this.repo.getIntent(prId);
    if (!stored) throw new AppError('intent_derivation_failed', 'Intent derivation did not persist', 502);
    return { pr_id: prId, ...stored };
  }
}
