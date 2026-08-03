import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-in-prompt] Docker not available — skipping integration tests.');
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

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `skills-prompt-${repoSeq++}`;
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
      title: 'Some change',
      author: 'someone',
      branch: 'feat/x',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: null,
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

/**
 * Acceptance test for the Wave-2 milestone: linked skills actually reach the
 * review prompt (before this wave, run-executor never passed `skills` to
 * `reviewPullRequest` at all — see reviews/CLAUDE.md).
 */
d('skills reach the review prompt (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.' },
    });
    return res.json().id as string;
  }

  async function createSkill(
    app: Awaited<ReturnType<typeof appWith>>,
    payload: {
      name: string;
      description: string;
      type: 'rubric' | 'convention' | 'security' | 'custom';
      source: 'manual' | 'imported_url' | 'extracted' | 'community';
      body: string;
    },
  ) {
    const res = await app.inject({ method: 'POST', url: '/skills', payload });
    return res.json().id as string;
  }

  it('two enabled skills (in link order) + one disabled skill: enabled ones are rendered as ### blocks, disabled one is absent, imported_url is untrusted-wrapped, manual is not', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentId = await createAgent(app, 'Skilled Reviewer');

    const manualSkillId = await createSkill(app, {
      name: 'Manual Skill Alpha',
      description: 'A manual rubric.',
      type: 'rubric',
      source: 'manual',
      body: 'Check every branch has a test.',
    });
    const importedSkillId = await createSkill(app, {
      name: 'Imported Skill Beta',
      description: 'An imported checklist.',
      type: 'custom',
      source: 'imported_url',
      body: 'Follow the imported checklist.',
    });
    const disabledSkillId = await createSkill(app, {
      name: 'Disabled Skill Gamma',
      description: 'Should never appear.',
      type: 'convention',
      source: 'manual',
      body: 'This must never reach the prompt.',
    });

    // The imported skill is server-forced to enabled:false on create — flip it
    // to true so it participates as an "enabled untrusted" skill in this test.
    await app.inject({
      method: 'PUT',
      url: `/skills/${importedSkillId}`,
      payload: { enabled: true },
    });
    // The "disabled" fixture skill is enabled:true by default (manual) — turn it off.
    await app.inject({
      method: 'PUT',
      url: `/skills/${disabledSkillId}`,
      payload: { enabled: false },
    });

    // Link in explicit order: manual (0), imported (1), disabled (2).
    const { db } = pg.handle;
    await db.insert(t.agentSkills).values([
      { agentId, skillId: manualSkillId, order: 0 },
      { agentId, skillId: importedSkillId, order: 1 },
      { agentId, skillId: disabledSkillId, order: 2 },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;

    await waitForPrRuns(db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const skillsBlock = trace.prompt_assembly.skills as string | null;

    expect(skillsBlock).not.toBeNull();
    expect(skillsBlock).toContain('### Manual Skill Alpha');
    expect(skillsBlock).toContain('### Imported Skill Beta');
    expect(skillsBlock).not.toContain('Disabled Skill Gamma');

    // Order: manual (link order 0) appears before imported (link order 1).
    expect(skillsBlock!.indexOf('### Manual Skill Alpha')).toBeLessThan(
      skillsBlock!.indexOf('### Imported Skill Beta'),
    );

    // manual is trusted verbatim — no <untrusted> wrapper around its body.
    const manualBlockStart = skillsBlock!.indexOf('### Manual Skill Alpha');
    const importedBlockStart = skillsBlock!.indexOf('### Imported Skill Beta');
    const manualSection = skillsBlock!.slice(manualBlockStart, importedBlockStart);
    expect(manualSection).not.toContain('<untrusted');

    // imported_url is wrapped in <untrusted source="skill-…">.
    expect(skillsBlock).toMatch(/<untrusted source="skill-imported-skill-beta">/);
    expect(skillsBlock).toContain('Follow the imported checklist.');

    // The rendered user prompt also carries the '## Skills / rules' heading.
    expect(trace.prompt_assembly.user).toContain('## Skills / rules');

    await app.close();
  });

  it('an agent with no linked skills gets prompt_assembly.skills === null and no "## Skills / rules" heading', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentId = await createAgent(app, 'Skill-less Reviewer');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    const runId = res.json().runs[0].run_id as string;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Skills / rules');

    await app.close();
  });
});
