import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { buildReviewDeps } from '../src/modules/reviews/routes.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import { McpToolsService, mcpToolsDeps } from '../src/modules/mcp-tools/service.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[mcp-project-context-parity] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 100,
  findings: [],
};

/**
 * `0001b`, Step 4, AC-31 — "MCP `run_agent_on_pr` behaves IDENTICALLY to the
 * studio HTTP path": an agent with an attached project-context document must
 * produce a run trace whose `specs_read` is non-empty, exactly like
 * `project-context-prompt.it.test.ts`'s HTTP-path assertion.
 *
 * `plan-verifier` traced the wiring statically (`mcp-server.ts:28` builds
 * `ReviewService` from the SAME `buildReviewDeps(container)` factory
 * `reviews/routes.ts:55` uses — no branch, no second executor construction)
 * but found no test exercising the MCP service path itself. This test drives
 * the actual `McpToolsService.runAgentOnPr` — the same call
 * `mcp-server.ts` wires `run_agent_on_pr` to — rather than the HTTP route,
 * so a future change that only special-cases the HTTP path would fail here
 * without touching `project-context-prompt.it.test.ts` at all.
 */
d('MCP run_agent_on_pr project-context parity (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setupRepoAndPr(files: Record<string, string>) {
    const name = `mcp-context-parity-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900 + repoSeq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: null,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, files }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });

    // The SAME composition `mcp-server.ts` uses for `run_agent_on_pr`:
    // `new ReviewService(buildReviewDeps(container))` fed into `McpToolsService`
    // via `mcpToolsDeps`. Building it here (rather than a hand-rolled stub)
    // is the point — a divergence in `buildReviewDeps` would be invisible to a
    // test that mocked `ReviewRunner` instead of constructing the real thing.
    const reviewService = new ReviewService(buildReviewDeps(app.container));
    const toolsService = new McpToolsService(
      mcpToolsDeps({
        agentsRepo: app.container.agentsRepo,
        reviewRepo: app.container.reviewRepo,
        repoRepo: app.container.repoRepo,
        reviewRunner: reviewService,
        conventionsReader: { getConventions: () => Promise.reject(new Error('unused in this test')) },
        blastReader: { forPull: () => Promise.reject(new Error('unused in this test')) },
        workspaceId: async () => workspaceId,
      }),
    );

    return { app, reviewService, toolsService, repo: repo!, pr: pr! };
  }

  it('an MCP run_agent_on_pr call on an agent with an attached document produces a trace with non-empty specs_read (AC-31)', async () => {
    const { app, reviewService, toolsService, repo, pr } = await setupRepoAndPr({
      'specs/api.md': 'The API must be versioned.',
    });

    const [agentRow] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'MCP Context Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();

    const contextRepo = new ProjectContextRepository(pg.handle.db);
    await contextRepo.setForAgent(workspaceId, agentRow!.id, ['specs/api.md']);

    const result = await toolsService.runAgentOnPr(repo.fullName, pr.number, agentRow!.id);
    expect(result.run_status).toBe('completed');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({ agent_id: agentRow!.id, status: 'done' });

    // `runReviewAndWait` fires the run in the same background executor the
    // HTTP path uses — wait for it to land in a terminal DB state before
    // reading the persisted trace (waitForPrRuns's silent-timeout trap:
    // pass an explicit, generous timeout, not the 10s default).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1, timeoutMs: 30_000 });

    const [runRow] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(runRow!.status).toBe('done');

    const trace = await reviewService.getRunTrace(runRow!.id);
    expect(trace).toBeDefined();

    // Same assertions as the HTTP path in project-context-prompt.it.test.ts —
    // this is the parity check: same prompt section, same wrapper, same
    // specs_read shape, reached through the MCP service call instead of
    // `POST /pulls/:id/review`.
    expect(trace!.prompt_assembly.user).toContain('## Project context');
    expect(trace!.prompt_assembly.user).toContain('The API must be versioned.');
    expect(trace!.prompt_assembly.user).toMatch(/<untrusted source="spec-0">/);

    expect(trace!.specs_read).toHaveLength(1);
    expect(trace!.specs_read[0]).toMatchObject({
      path: 'specs/api.md',
      status: 'injected',
      origin: 'agent',
    });
    expect((trace!.specs_read[0] as { tokens: number }).tokens).toBeGreaterThan(0);

    await app.close();
  });

  it('an MCP run_agent_on_pr call on an agent with no attachments gets no "## Project context" section and empty specs_read', async () => {
    const { app, reviewService, toolsService, repo, pr } = await setupRepoAndPr({});

    const [agentRow] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'MCP No Context Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();

    const result = await toolsService.runAgentOnPr(repo.fullName, pr.number, agentRow!.id);
    expect(result.run_status).toBe('completed');

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1, timeoutMs: 30_000 });

    const [runRow] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    const trace = await reviewService.getRunTrace(runRow!.id);
    expect(trace).toBeDefined();

    expect(trace!.prompt_assembly.user).not.toContain('## Project context');
    expect(trace!.specs_read).toEqual([]);

    await app.close();
  });
});
