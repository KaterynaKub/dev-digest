import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * smart-diff routes — registration and edge validation, WITHOUT a DB.
 * Behaviour that needs rows lives in `smart-diff.it.test.ts`.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PR_ID = '11111111-1111-4111-8111-111111111111';

describe('smart-diff routes (no DB)', () => {
  // An UNregistered route falls through to fastify's built-in 404, whose body
  // has no `error` envelope. A registered route that simply cannot find the
  // PR produces OUR structured 404. So the envelope — not the status — is
  // what proves the plugin loaded.
  it('GET /pulls/:id/smart-diff is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/smart-diff` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('rejects a non-uuid pr id with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
