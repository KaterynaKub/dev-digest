import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { buildReviewDeps } from '../src/modules/reviews/routes.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review, LLMProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** Wraps a real LLMProvider and delays every completeStructured call — used
 *  to force `runReviewAndWait`'s timeout race deterministically. */
function delayedProvider(inner: LLMProvider, delayMs: number): LLMProvider {
  return {
    ...inner,
    completeStructured: async (req) => {
      await new Promise((r) => setTimeout(r, delayMs));
      return inner.completeStructured(req);
    },
  } as LLMProvider;
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-mcp-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
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
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('runReviewAndWait (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function serviceWith(llm: LLMProvider) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
    const service = new ReviewService(buildReviewDeps(app.container));
    return { app, service };
  }

  it('reaches a terminal status and returns findings within one call', async () => {
    const { app, service } = await serviceWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [agentRow] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'MCP Sec',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'sec',
      })
      .returning();

    const result = await service.runReviewAndWait(workspaceId, pr.id, [agentRow!], 10_000);

    expect(result.timedOut).toBe(false);
    expect(result.runs).toHaveLength(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]!.findings).toHaveLength(1);
    expect(result.reviews[0]!.findings[0]!.file).toBe('src/config.ts');

    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, result.runs[0]!.run_id));
    expect(run!.status).toBe('done');

    await app.close();
  });

  it('cancels the run and reports timedOut on a short timeout', async () => {
    const slow = delayedProvider(
      new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
      2_000,
    );
    const { app, service } = await serviceWith(slow);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const [agentRow] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'MCP Slow',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'sec',
      })
      .returning();

    const result = await service.runReviewAndWait(workspaceId, pr.id, [agentRow!], 50);

    expect(result.timedOut).toBe(true);
    expect(result.runs).toHaveLength(1);

    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, result.runs[0]!.run_id));
    expect(run!.status).toBe('cancelled');

    await app.close();
  });
});
