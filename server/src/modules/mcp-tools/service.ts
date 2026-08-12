import type { CiFailOn } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  compactFinding,
  deriveVerdict,
  normalizeRepo,
  toMcpAgent,
  truncateFindings,
  type FindingLike,
  type McpAgent,
  type McpFinding,
  type McpVerdict,
} from './helpers.js';
import { FINDINGS_LIMIT_CONCISE, FINDINGS_LIMIT_DETAILED, RUN_TIMEOUT_MS } from './constants.js';

/**
 * Ports this service needs. Injected explicitly — never the whole Container
 * (constraint 1, `.dependency-cruiser.cjs`'s `service-no-container`).
 *
 * `reviewRunner` and `conventionsReader` are LOCAL structural interfaces over
 * `ReviewService`/`ConventionsService` — NOT imports of those services
 * (constraint 2, `no-cross-module-service`, severity error, also catches
 * `import type` because `tsPreCompilationDeps: true`). `mcp-server.ts` (the
 * composition root) passes the real instances in; TypeScript only checks
 * structural compatibility here.
 *
 * `agentsRepo`, `reviewRepo`, `repoRepo` are REPOSITORIES of other modules,
 * which constraint 3 explicitly allows (the same pattern as
 * `reviews/run-executor.ts` importing `AgentsRepository`).
 */
export interface McpToolsDeps {
  agentsRepo: AgentsRepoPort;
  reviewRepo: ReviewRepoPort;
  repoRepo: RepoRepoPort;
  reviewRunner: ReviewRunner;
  conventionsReader: ConventionsReader;
  /** `LocalNoAuthProvider.currentWorkspace().id` — resolved OUTSIDE HTTP (no `FastifyRequest`). */
  workspaceId: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Structural ports — only the fields/methods this service actually calls.
// No Drizzle row type is named here (constraint 7): every field the port
// reads is spelled out as a primitive/plain shape, never `AgentRow` etc.
// ---------------------------------------------------------------------------

export interface AgentRowLike {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled: boolean;
  ciFailOn: CiFailOn;
}

export interface AgentsRepoPort {
  list(workspaceId: string): Promise<AgentRowLike[]>;
  getById(workspaceId: string, id: string): Promise<AgentRowLike | undefined>;
}

export interface RepoRowLike {
  id: string;
  fullName: string;
}

export interface RepoRepoPort {
  findByFullName(workspaceId: string, fullName: string): Promise<RepoRowLike | undefined>;
}

export interface ReviewWithFindings {
  agent_id: string | null;
  run_id: string | null;
  findings: FindingLike[];
}

export interface ReviewRepoPort {
  findPullByNumber(
    workspaceId: string,
    fullName: string,
    number: number,
  ): Promise<{ prId: string; repoId: string; headSha: string } | undefined>;
}

/**
 * Structural port over `ReviewService` (constraint 2) — never the class
 * itself. `reviewsForPull` returns the same DTO shape `runReviewAndWait`
 * does (both ultimately `ReviewService.reviewsForPull`'s `ReviewDto[]`), so
 * `get_findings` (a pure read) and `run_agent_on_pr` (read after running)
 * share one `collectFindings` helper below.
 */
export interface ReviewRunner {
  resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRowLike[]>;
  runReviewAndWait(
    workspaceId: string,
    prId: string,
    targets: AgentRowLike[],
    timeoutMs: number,
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    timedOut: boolean;
    reviews: ReviewWithFindings[];
  }>;
  reviewsForPull(workspaceId: string, prId: string): Promise<ReviewWithFindings[]>;
}

export interface ConventionRowLike {
  category: string;
  rule: string;
  evidence_path: string;
}

export interface ConventionsViewLike {
  scan: { created_at: string } | null;
  candidates: ConventionRowLike[];
}

/** Structural port over `ConventionsService.view` (constraint 2). */
export interface ConventionsReader {
  view(workspaceId: string, repoId: string): Promise<ConventionsViewLike>;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface RunAgentResult {
  verdict: McpVerdict;
  findings: McpFinding[];
  agents: { agent_id: string; agent_name: string; status: string }[];
  run_status: 'completed' | 'timed_out';
  shown: number;
  total: number;
  note?: string;
}

export interface GetConventionsResult {
  conventions: ConventionRowLike[];
  scanned_at: string | null;
  total: number;
}

/**
 * `NotFoundError`/`ValidationError`-throwing errors this service can raise;
 * the MCP wrapper layer (`src/mcp/errors.ts`) catches each by `instanceof`
 * and maps it to its dedicated `isError:true` text (Step 6).
 */
export class AgentNotFoundError extends NotFoundError {
  constructor(public readonly agentId: string) {
    super('Agent not found');
  }
}

export class RepoNotFoundError extends NotFoundError {
  constructor(public readonly repo: string) {
    super('Repository not found');
  }
}

export class RepoFormatError extends ValidationError {
  constructor(public readonly input: string) {
    super('Repository format not recognized');
  }
}

export class PullNotFoundError extends NotFoundError {
  constructor(
    public readonly repo: string,
    public readonly number: number,
  ) {
    super('Pull request not found');
  }
}

export class NoReviewYetError extends NotFoundError {
  constructor(
    public readonly repo: string,
    public readonly number: number,
  ) {
    super('No review has run yet');
  }
}

export class McpToolsService {
  constructor(private deps: McpToolsDeps) {}

  // -------------------------------------------------------------- list_agents

  async listAgents(): Promise<McpAgent[]> {
    const workspaceId = await this.deps.workspaceId();
    const rows = await this.deps.agentsRepo.list(workspaceId);
    return rows.map(toMcpAgent);
  }

  // --------------------------------------------------------- run_agent_on_pr

  /**
   * Resolve `repo`+`pr` → prId, resolve targets (one agent or every enabled
   * agent), run and WAIT (`ReviewRunner.runReviewAndWait`), then return the
   * finished verdict + findings in ONE call — principle #1.
   */
  async runAgentOnPr(
    repoInput: string,
    pr: number,
    agentId: string | undefined,
  ): Promise<RunAgentResult> {
    const workspaceId = await this.deps.workspaceId();
    const { prId } = await this.resolvePr(workspaceId, repoInput, pr);
    const targets = await this.resolveTargets(workspaceId, agentId);

    const { runs, timedOut, reviews } = await this.deps.reviewRunner.runReviewAndWait(
      workspaceId,
      prId,
      targets,
      RUN_TIMEOUT_MS,
    );

    // A run without a matching finished review is one the timeout cancelled —
    // `runReviewAndWait` only returns reviews for runs that reached a
    // terminal status via the executor; a cancelled run never gets one.
    const finishedRunIds = new Set(reviews.map((r) => r.run_id).filter((id): id is string => id !== null));
    const agents = runs.map((r) => ({
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      status: finishedRunIds.has(r.run_id) ? 'done' : 'cancelled',
    }));

    const gateByAgent = new Map(targets.map((a) => [a.id, a.ciFailOn]));
    const { findings, verdict } = this.collectFindings(reviews, gateByAgent);
    const { shown, total, note } = truncateFindings(findings, FINDINGS_LIMIT_CONCISE);

    return {
      verdict,
      findings: shown,
      agents,
      run_status: timedOut ? 'timed_out' : 'completed',
      shown: shown.length,
      total,
      ...(note ? { note } : {}),
    };
  }

  // ------------------------------------------------------------ get_findings

  async getFindings(
    repoInput: string,
    pr: number,
    format: 'CONCISE' | 'DETAILED',
  ): Promise<RunAgentResult> {
    const workspaceId = await this.deps.workspaceId();
    const { prId } = await this.resolvePr(workspaceId, repoInput, pr);

    const reviews = await this.deps.reviewRunner.reviewsForPull(workspaceId, prId);
    if (reviews.length === 0) throw new NoReviewYetError(repoInput, pr);

    const agentRows = await this.deps.agentsRepo.list(workspaceId);
    const gateByAgent = new Map(agentRows.map((a) => [a.id, a.ciFailOn]));
    const nameByAgent = new Map(agentRows.map((a) => [a.id, a.name]));

    const { findings, verdict } = this.collectFindings(reviews, gateByAgent);
    const limit = format === 'DETAILED' ? FINDINGS_LIMIT_DETAILED : FINDINGS_LIMIT_CONCISE;
    const { shown, total, note } = truncateFindings(findings, limit);

    const agents = reviews
      .filter((r) => r.agent_id !== null)
      .map((r) => ({
        agent_id: r.agent_id as string,
        agent_name: nameByAgent.get(r.agent_id as string) ?? 'unknown',
        status: 'done',
      }));

    return {
      verdict,
      findings: shown,
      agents,
      run_status: 'completed',
      shown: shown.length,
      total,
      ...(note ? { note } : {}),
    };
  }

  // --------------------------------------------------------- get_conventions

  async getConventions(repoInput: string): Promise<GetConventionsResult> {
    const workspaceId = await this.deps.workspaceId();
    const repo = await this.resolveRepo(workspaceId, repoInput);

    const view = await this.deps.conventionsReader.view(workspaceId, repo.id);
    return {
      conventions: view.candidates,
      scanned_at: view.scan?.created_at ?? null,
      total: view.candidates.length,
    };
  }

  // ------------------------------------------------------------- internals

  private async resolveRepo(workspaceId: string, repoInput: string): Promise<RepoRowLike> {
    const fullName = normalizeRepo(repoInput);
    if (!fullName) throw new RepoFormatError(repoInput);
    const repo = await this.deps.repoRepo.findByFullName(workspaceId, fullName);
    if (!repo) throw new RepoNotFoundError(fullName);
    return repo;
  }

  private async resolvePr(
    workspaceId: string,
    repoInput: string,
    pr: number,
  ): Promise<{ fullName: string; prId: string }> {
    // Distinguish "repo not connected" from "PR not found in a connected repo"
    // — the two error texts (Step 6) name different next actions.
    const repo = await this.resolveRepo(workspaceId, repoInput);
    const pull = await this.deps.reviewRepo.findPullByNumber(workspaceId, repo.fullName, pr);
    if (!pull) throw new PullNotFoundError(repo.fullName, pr);
    return { fullName: repo.fullName, prId: pull.prId };
  }

  private async resolveTargets(
    workspaceId: string,
    agentId: string | undefined,
  ): Promise<AgentRowLike[]> {
    if (agentId) {
      const agent = await this.deps.agentsRepo.getById(workspaceId, agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      return [agent];
    }
    // No agent → every enabled agent (customer decision, spec Step 5/Open questions #3).
    return this.deps.reviewRunner.resolveTargets(workspaceId, { all: true });
  }

  private collectFindings(
    reviews: ReviewWithFindings[],
    gateByAgent: Map<string, CiFailOn>,
  ): { findings: McpFinding[]; verdict: McpVerdict } {
    const allRaw: FindingLike[] = [];
    let worst: McpVerdict = 'clean';
    for (const review of reviews) {
      allRaw.push(...review.findings);
      const gate = (review.agent_id && gateByAgent.get(review.agent_id)) || 'critical';
      const v = deriveVerdict(review.findings, gate);
      if (v === 'blocked') worst = 'blocked';
      else if (v === 'concerns' && worst !== 'blocked') worst = 'concerns';
    }
    return { findings: allRaw.map(compactFinding), verdict: worst };
  }
}

/** Build the service's ports from the container (mirrors `reviewDeps`/`conventionsDeps`). */
export function mcpToolsDeps(container: {
  agentsRepo: AgentsRepoPort;
  reviewRepo: ReviewRepoPort;
  repoRepo: RepoRepoPort;
  reviewRunner: ReviewRunner;
  conventionsReader: ConventionsReader;
  workspaceId: () => Promise<string>;
}): McpToolsDeps {
  return {
    agentsRepo: container.agentsRepo,
    reviewRepo: container.reviewRepo,
    repoRepo: container.repoRepo,
    reviewRunner: container.reviewRunner,
    conventionsReader: container.conventionsReader,
    workspaceId: container.workspaceId,
  };
}
