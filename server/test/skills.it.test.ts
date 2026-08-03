import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildMultipartBody } from './helpers/multipart.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsService } from '../src/modules/skills/service.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module — CRUD, body-only versioning, the import-vetting gate, the
 * stateless import/preview path, and workspace scoping / 404s / 422s.
 */
d('skills module (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'Test Coverage Rubric',
    description: 'Flags untested branches.',
    type: 'rubric' as const,
    source: 'manual' as const,
    body: 'Every new branch needs a test.',
  };

  it('POST /skills → 201, version 1, and a skill_versions row', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.version).toBe(1);
    expect(skill.enabled).toBe(true);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0]).toMatchObject({
      skill_id: skill.id,
      version: 1,
      body: createBody.body,
    });
    await app.close();
  });

  it('changing body bumps to v2 and versions list is [2,1]', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}`,
      payload: { body: 'Updated body text.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].body).toBe('Updated body text.');
    expect(versions[1].body).toBe(createBody.body);
    await app.close();
  });

  it('changing only name/description/type does NOT bump the version', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}`,
      payload: { name: 'Renamed Rubric', description: 'New description.', type: 'convention' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(1);
    expect(updated.json().name).toBe('Renamed Rubric');

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('toggling enabled does NOT bump the version', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}`,
      payload: { enabled: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(1);
    expect(updated.json().enabled).toBe(false);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('GET /skills/:id/versions/abc → 422, not 404', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;
    const res = await app.inject({ method: 'GET', url: `/skills/${skillId}/versions/abc` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('404s for an unknown skill, an unknown version, and cross-workspace access', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${ghost}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${skillId}/versions/99` })).statusCode,
    ).toBe(404);

    // Cross-workspace: a skill in a different workspace, addressed directly via
    // the service (bypassing HTTP) to prove workspace scoping, same pattern as
    // agents-versions.it.test.ts.
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-skills-ws' }).returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Skill',
      description: 'lives in another workspace',
      type: 'custom',
      source: 'manual',
      body: 'x',
    });
    const service = new SkillsService({ repo: new SkillsRepository(db) });
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    expect(await service.get(otherWs!.id, foreign.id)).toBeDefined();
    expect(await service.get(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();
    await app.close();
  });

  it('source: imported_url with enabled:true is FORCED to enabled:false on save', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Imported Checklist',
        description: 'From an import.',
        type: 'custom',
        source: 'imported_url',
        body: 'Do the thing.',
        enabled: true, // client asked for enabled — the server must override this
        evidence_files: ['SKILL.md'],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().enabled).toBe(false);
    await app.close();
  });

  it('POST /skills/import/preview with a .md file returns a SkillDraft and persists NOTHING', async () => {
    const app = await makeApp();
    const before = await pg.handle.db.select().from(t.skills);

    const { body, contentType } = buildMultipartBody([
      {
        fieldName: 'file',
        filename: 'edge-cases.md',
        content: [
          '---',
          'name: Edge Case Checklist',
          'description: Covers empty/null/boundary cases.',
          'type: rubric',
          '---',
          '',
          'Body of the skill.',
        ].join('\n'),
        contentType: 'text/markdown',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json();
    expect(draft).toMatchObject({
      name: 'Edge Case Checklist',
      description: 'Covers empty/null/boundary cases.',
      type: 'rubric',
    });

    const after = await pg.handle.db.select().from(t.skills);
    expect(after.length).toBe(before.length); // nothing persisted — the whole point of preview
    await app.close();
  });

  it('POST /skills/import/preview with an unsupported extension → 422', async () => {
    const app = await makeApp();
    const { body, contentType } = buildMultipartBody([
      { fieldName: 'file', filename: 'skill.exe', content: Buffer.from([0x4d, 0x5a, 0x00, 0x00]) },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE /skills/:id cascades agent_skills links', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody }))
      .json().id as string;

    const { db } = pg.handle;
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId: defaultWs!,
        name: 'Cascade Test Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();
    await db.insert(t.agentSkills).values({ agentId: agent!.id, skillId, order: 0 });

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    const links = await db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    expect(links).toHaveLength(0);
    await app.close();
  });

  it('DELETE /skills/:id on an unknown skill → 404', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({ method: 'DELETE', url: `/skills/${ghost}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
