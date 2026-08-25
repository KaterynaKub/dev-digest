import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * project-context routes — registration and edge validation, WITHOUT a DB.
 * Mirrors `blast-routes.test.ts` / `smart-diff-routes.test.ts`: an unregistered
 * route falls through to Fastify's built-in 404 (no `error` envelope); a
 * registered route that simply can't find the repo/agent/skill produces OUR
 * structured error, which is what proves the plugin loaded.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const SKILL_ID = '33333333-3333-4333-8333-333333333333';

describe('project-context routes (no DB)', () => {
  it('GET /repos/:id/project-context/docs is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context/docs` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('GET /repos/:id/project-context/doc requires a path query param (422)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context/doc` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('PUT /repos/:id/project-context/doc requires path + content in the body (422)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'PUT',
      url: `/repos/${REPO_ID}/project-context/doc`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /repos/:id/project-context/dirty is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context/dirty` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('rejects a non-uuid repo id with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/project-context/docs' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /agents/:id/context-docs is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/context-docs` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('POST /agents/:id/context-docs rejects a body without paths (422)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/context-docs`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('POST /agents/:id/context-docs rejects more than 20 paths at the edge (422)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${AGENT_ID}/context-docs`,
      payload: { paths: Array.from({ length: 21 }, (_, i) => `specs/${i}.md`) },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('GET /skills/:id/context-docs is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/context-docs` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('POST /skills/:id/context-docs rejects a body without paths (422)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${SKILL_ID}/context-docs`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
