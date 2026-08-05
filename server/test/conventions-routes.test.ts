import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * Conventions routes — registration and edge validation, WITHOUT a DB.
 * Behaviour that needs rows lives in `conventions.it.test.ts`.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REPO_ID = '11111111-1111-4111-8111-111111111111';

describe('conventions routes (no DB)', () => {
  // An UNregistered route falls through to fastify's built-in 404, whose body
  // has no `error` envelope. A registered route that simply cannot find the
  // repo produces OUR structured 404. So the envelope — not the status — is
  // what proves the plugin loaded.
  it('GET /repos/:id/conventions is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/conventions` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('POST /repos/:id/conventions/extract is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/conventions/extract`,
      payload: {},
    });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('GET /repos/:id/conventions/skill-draft is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/conventions/skill-draft`,
    });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('rejects a non-uuid repo id with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/conventions' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects an unknown provider in the extract body with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/conventions/extract`,
      payload: { provider: 'not-a-provider', model: 'x' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects an invalid status in the PATCH body with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${REPO_ID}`,
      payload: { status: 'maybe' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects an invalid status in the bulk body with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/conventions/bulk`,
      payload: { status: 'maybe' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('accepts an empty extract body (model choice is optional)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/conventions/extract`,
      payload: {},
    });
    // Not a validation failure — it gets as far as the DB/repo lookup.
    expect(res.statusCode).not.toBe(422);
    await app.close();
  });
});
