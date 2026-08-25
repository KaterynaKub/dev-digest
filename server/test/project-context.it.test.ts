import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { RepoRepository } from '../src/modules/repos/repository.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * `ProjectContextRepository` persistence: attachment set/order/full-replace
 * for agents and skills (AC-8…AC-11, AC-52), the 20-doc scale (checked at the
 * service layer, not enforced here — repository stays a dumb full-replace),
 * `attachmentCountsByPath` (AC-14), and `listForAgentWithSkills`'s enabled-only
 * inheritance ordering.
 *
 * Every fixture starts from `await seed(db)` — `LocalNoAuthProvider` always
 * resolves the SEEDED default workspace by name, so a test that inserts its
 * own workspace row without seeding first builds fixtures the app can never
 * reach (see root `INSIGHTS.md`).
 */
d('ProjectContextRepository', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeAgent(name: string) {
    const repo = new AgentsRepository(pg.handle.db);
    return repo.insert({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    });
  }

  async function makeSkill(name: string, enabled = true) {
    const repo = new SkillsRepository(pg.handle.db);
    return repo.insert({
      workspaceId,
      name,
      description: 'A test skill.',
      type: 'custom',
      source: 'manual',
      body: 'Do the thing.',
      enabled,
    });
  }

  it('setForAgent persists paths in order; listForAgent reads them back', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const agent = await makeAgent('Agent A');

    await repo.setForAgent(workspaceId, agent.id, ['specs/b.md', 'specs/a.md']);
    const docs = await repo.listForAgent(workspaceId, agent.id);
    expect(docs).toEqual([
      { path: 'specs/b.md', order: 0 },
      { path: 'specs/a.md', order: 1 },
    ]);
  });

  it('setForAgent is a FULL REPLACE — re-calling with a smaller set drops the rest', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const agent = await makeAgent('Agent B');

    await repo.setForAgent(workspaceId, agent.id, ['specs/a.md', 'specs/b.md', 'specs/c.md']);
    await repo.setForAgent(workspaceId, agent.id, ['specs/c.md']);

    const docs = await repo.listForAgent(workspaceId, agent.id);
    expect(docs).toEqual([{ path: 'specs/c.md', order: 0 }]);
  });

  it('setForAgent with an empty array clears all attachments', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const agent = await makeAgent('Agent C');

    await repo.setForAgent(workspaceId, agent.id, ['specs/a.md']);
    await repo.setForAgent(workspaceId, agent.id, []);

    expect(await repo.listForAgent(workspaceId, agent.id)).toEqual([]);
  });

  it('re-attaching the same path across separate calls does not accumulate rows (PK on agent_id+path)', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const agent = await makeAgent('Agent D');

    // Two SEPARATE calls with the same final path — each is a full replace,
    // so this must not duplicate the row even though the delete+insert pair
    // runs twice against the same (agent_id, path) primary key.
    await repo.setForAgent(workspaceId, agent.id, ['specs/a.md']);
    await repo.setForAgent(workspaceId, agent.id, ['specs/a.md']);
    expect(await repo.listForAgent(workspaceId, agent.id)).toEqual([
      { path: 'specs/a.md', order: 0 },
    ]);
  });

  it('setForSkill / listForSkill mirror the agent behaviour', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const skill = await makeSkill('Skill A');

    await repo.setForSkill(workspaceId, skill.id, ['docs/x.md', 'docs/y.md']);
    const docs = await repo.listForSkill(workspaceId, skill.id);
    expect(docs).toEqual([
      { path: 'docs/x.md', order: 0 },
      { path: 'docs/y.md', order: 1 },
    ]);
  });

  it('attachmentCountsByPath counts agents per path, workspace-scoped (AC-14)', async () => {
    const repo = new ProjectContextRepository(pg.handle.db);
    const agent1 = await makeAgent('Counter Agent 1');
    const agent2 = await makeAgent('Counter Agent 2');

    await repo.setForAgent(workspaceId, agent1.id, ['specs/shared.md', 'specs/only-1.md']);
    await repo.setForAgent(workspaceId, agent2.id, ['specs/shared.md']);

    const counts = await repo.attachmentCountsByPath(workspaceId);
    expect(counts.get('specs/shared.md')).toBe(2);
    expect(counts.get('specs/only-1.md')).toBe(1);
    expect(counts.has('specs/never-attached.md')).toBe(false);
  });

  it('listForAgentWithSkills orders inherited docs by agent_skills.order and excludes disabled skills', async () => {
    const projectRepo = new ProjectContextRepository(pg.handle.db);
    const agentsRepo = new AgentsRepository(pg.handle.db);
    const agent = await makeAgent('Agent With Skills');
    const skillEnabled1 = await makeSkill('Enabled Skill 1', true);
    const skillEnabled2 = await makeSkill('Enabled Skill 2', true);
    const skillDisabled = await makeSkill('Disabled Skill', false);

    await projectRepo.setForAgent(workspaceId, agent.id, ['specs/own.md']);
    await projectRepo.setForSkill(workspaceId, skillEnabled1.id, ['docs/from-skill-1.md']);
    await projectRepo.setForSkill(workspaceId, skillEnabled2.id, ['docs/from-skill-2.md']);
    await projectRepo.setForSkill(workspaceId, skillDisabled.id, ['docs/from-disabled.md']);

    // Link in a deliberate non-alphabetical order: skill2 first, then skill1,
    // then the disabled skill — order must follow agent_skills.order, and the
    // disabled skill's docs must not appear at all.
    await agentsRepo.linkSkill(agent.id, skillEnabled2.id, 0);
    await agentsRepo.linkSkill(agent.id, skillEnabled1.id, 1);
    await agentsRepo.linkSkill(agent.id, skillDisabled.id, 2);

    const view = await projectRepo.listForAgentWithSkills(workspaceId, agent.id);
    expect(view.agent).toEqual([{ path: 'specs/own.md', order: 0 }]);
    expect(view.inherited.map((d) => d.path)).toEqual([
      'docs/from-skill-2.md',
      'docs/from-skill-1.md',
    ]);
    expect(view.inherited.every((d) => d.path !== 'docs/from-disabled.md')).toBe(true);
    expect(view.inherited.map((d) => d.skillId)).toEqual([skillEnabled2.id, skillEnabled1.id]);
  });

  it('attachments are workspace-scoped: another tenant cannot read or count them', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-pc' }).returning();
    const otherWorkspaceId = otherWs!.id;

    const foreignRepo = new AgentsRepository(db);
    const foreignAgent = await foreignRepo.insert({
      workspaceId: otherWorkspaceId,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    const repo = new ProjectContextRepository(db);
    await repo.setForAgent(otherWorkspaceId, foreignAgent.id, ['specs/foreign.md']);

    // Same agent id looked up under the wrong workspace sees nothing.
    expect(await repo.listForAgent(workspaceId, foreignAgent.id)).toEqual([]);
    const counts = await repo.attachmentCountsByPath(workspaceId);
    expect(counts.has('specs/foreign.md')).toBe(false);

    const foreignCounts = await repo.attachmentCountsByPath(otherWorkspaceId);
    expect(foreignCounts.get('specs/foreign.md')).toBe(1);
  });
});

/**
 * Routes-level checks for the two `0001a` remediation items:
 *   - `PUT .../doc` logs path + outcome, NEVER the document text (NFR-11/NFR-17).
 *   - `GET /agents|skills/:id/context-docs?repoId=` marks a path missing:true
 *     when it does not resolve against that repo's clone (AC-37), never
 *     removing the attachment.
 * Both need a real DB-backed repo row (for `RepoRepository.getById`) plus a
 * `git` override, so they run here rather than in the no-DB routes-smoke test.
 */
d('project-context routes — write logging + missing attachments', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeRepo(fullName: string, clonePath: string | null) {
    const [owner, name] = fullName.split('/');
    // Inserted directly (not via RepoRepository.insert) — `created_by` is
    // nullable in the schema but required by `InsertRepo`; other it.tests in
    // this suite (e.g. `pulls-comments.it.test.ts`) omit it the same way.
    const [row] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: owner!, name: name!, fullName })
      .returning();
    const repoRepo = new RepoRepository(pg.handle.db);
    if (clonePath) await repoRepo.updateClonePath(row!.id, clonePath);
    return repoRepo.getById(workspaceId, row!.id);
  }

  /** Spies on `req.log.info`/`req.log.warn` for exactly one request, via an
   *  `onRequest` hook installed before the route runs — Fastify has no public
   *  logger-capture API, so this wraps the request-scoped child logger's own
   *  methods in place. */
  function captureLogs(app: Awaited<ReturnType<typeof buildApp>>) {
    const calls: { level: 'info' | 'warn'; args: unknown[] }[] = [];
    app.addHook('onRequest', async (req) => {
      const origInfo = req.log.info.bind(req.log);
      const origWarn = req.log.warn.bind(req.log);
      (req.log as unknown as { info: (...a: unknown[]) => void }).info = (...args: unknown[]) => {
        calls.push({ level: 'info', args });
        return (origInfo as (...a: unknown[]) => void)(...args);
      };
      (req.log as unknown as { warn: (...a: unknown[]) => void }).warn = (...args: unknown[]) => {
        calls.push({ level: 'warn', args });
        return (origWarn as (...a: unknown[]) => void)(...args);
      };
    });
    return calls;
  }

  it('a successful write logs the path, never the content (NFR-11/NFR-17)', async () => {
    const repo = await makeRepo('acme/log-write-ok', '/mock/clones/acme/log-write-ok');
    const git = new MockGitClient({ files: {} });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db, overrides: { git } });
    const calls = captureLogs(app);
    await app.ready();

    const secretContent = 'SECRET_DOCUMENT_BODY_MUST_NEVER_BE_LOGGED';
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo!.id}/project-context/doc`,
      payload: { path: 'specs/a.md', content: secretContent },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const writeLog = calls.find((c) => c.level === 'info');
    expect(writeLog).toBeDefined();
    const [fields] = writeLog!.args as [Record<string, unknown>];
    expect(fields.path).toBe('specs/a.md');
    // The path field carries a document PATH, not the document TEXT — and no
    // logged field anywhere in the call contains the secret content.
    const serialized = JSON.stringify(writeLog!.args);
    expect(serialized).not.toContain(secretContent);

    await app.close();
  });

  it('a failed write logs path + reason as a warning, never the content', async () => {
    const repo = await makeRepo('acme/log-write-fail', null); // no clone → not_cloned
    const git = new MockGitClient({ files: {} });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db, overrides: { git } });
    const calls = captureLogs(app);
    await app.ready();

    const secretContent = 'SECRET_DOCUMENT_BODY_MUST_NEVER_BE_LOGGED';
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${repo!.id}/project-context/doc`,
      payload: { path: 'specs/a.md', content: secretContent },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ ok: false, reason: 'not_cloned' });

    const warnLog = calls.find((c) => c.level === 'warn');
    expect(warnLog).toBeDefined();
    const [fields] = warnLog!.args as [Record<string, unknown>];
    expect(fields.path).toBe('specs/a.md');
    expect(fields.reason).toBe('not_cloned');
    const serialized = JSON.stringify(warnLog!.args);
    expect(serialized).not.toContain(secretContent);

    await app.close();
  });

  it('GET /agents/:id/context-docs?repoId= marks a path missing:true when absent from that clone (AC-37)', async () => {
    const repo = await makeRepo('acme/missing-check', '/mock/clones/acme/missing-check');
    const git = new MockGitClient({ files: { 'specs/present.md': 'hello' } });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db, overrides: { git } });
    await app.ready();

    const agentsRepo = new AgentsRepository(pg.handle.db);
    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Missing-check Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const projectRepo = new ProjectContextRepository(pg.handle.db);
    await projectRepo.setForAgent(workspaceId, agent.id, ['specs/present.md', 'specs/gone.md']);

    const withoutRepoId = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs`,
    });
    const withoutBody = withoutRepoId.json() as { path: string; missing: boolean }[];
    // No repoId → no clone to check against → every attachment kept, missing:false.
    expect(withoutBody.every((r) => r.missing === false)).toBe(true);
    expect(withoutBody.map((r) => r.path).sort()).toEqual(['specs/gone.md', 'specs/present.md']);

    const withRepoId = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/context-docs?repoId=${repo!.id}`,
    });
    const withBody = withRepoId.json() as { path: string; missing: boolean }[];
    expect(withBody.find((r) => r.path === 'specs/present.md')?.missing).toBe(false);
    expect(withBody.find((r) => r.path === 'specs/gone.md')?.missing).toBe(true);
    // Never removed — both attachments are still present in the response.
    expect(withBody.length).toBe(2);

    await app.close();
  });
});
