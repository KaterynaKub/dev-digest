import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * blast routes — registration and edge validation, WITHOUT a DB. Mirrors
 * smart-diff-routes.test.ts. Behaviour that needs rows would live in a
 * blast.it.test.ts (not added — no new query worth verifying against a real
 * DB beyond what smart-diff/repository.ts's twin already covers).
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PR_ID = '11111111-1111-4111-8111-111111111111';

describe('blast routes (no DB)', () => {
  // An UNregistered route falls through to fastify's built-in 404, whose body
  // has no `error` envelope. A registered route that simply cannot find the
  // PR produces OUR structured 404. So the envelope — not the status — is
  // what proves the plugin loaded.
  it('GET /pulls/:id/blast is registered', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/blast` });
    expect(res.json()).toHaveProperty('error.code');
    await app.close();
  });

  it('rejects a non-uuid pr id with 422', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
