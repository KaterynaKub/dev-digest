import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions extractor — the evidence gate end to end, the code-only sample
 * selection, re-scan carry-forward, and workspace scoping.
 */

const USERS_TS = [
  "import { z } from 'zod';", // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  return user;', // 5
  '}', // 6
].join('\n');

const PACKAGE_JSON = JSON.stringify({ name: 'payments-api', type: 'module' }, null, 2);

/** One good candidate + one citing a file that was never sampled. */
const TWO_CANDIDATES = {
  candidates: [
    {
      category: 'Async',
      rule: 'Always use async/await instead of .then() chains.',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 3,
      evidence_end_line: 5,
      confidence: 0.91,
    },
    {
      category: 'Caching',
      rule: 'Redis access goes through the src/lib/redis.ts singleton.',
      evidence_path: 'src/lib/redis.ts', // never sampled → must be dropped
      evidence_start_line: 1,
      evidence_end_line: 9,
      confidence: 0.85,
    },
  ],
};

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
    workspaceId = repo!.workspaceId;
    // The extractor requires a finished clone.
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(eq(t.repos.id, repoId));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /** A repo-intel stub returning fixed sample paths (never throws, per contract). */
  function stubRepoIntel(paths: string[]): RepoIntel {
    return {
      getConventionSamples: async () => paths,
    } as unknown as RepoIntel;
  }

  function makeApp(opts: {
    files?: Record<string, string>;
    samples?: string[];
    structured?: unknown;
    llm?: MockLLMProvider;
  }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const llm =
      opts.llm ??
      new MockLLMProvider('openai', {
        structuredBySchema: { ConventionExtraction: opts.structured ?? { candidates: [] } },
      });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: opts.files ?? {} }),
        github: new MockGitHubClient(),
        repoIntel: stubRepoIntel(opts.samples ?? []),
        llm: { openai: llm, openrouter: llm, anthropic: llm },
      },
    });
  }

  async function clearConventions() {
    await pg.handle.db.delete(t.conventions).where(eq(t.conventions.repoId, repoId));
    await pg.handle.db.delete(t.conventionScans).where(eq(t.conventionScans.repoId, repoId));
  }

  it('extracts, verifies, and drops the hallucinated candidate', async () => {
    await clearConventions();
    const app = makeApp({
      files: { 'src/api/users.ts': USERS_TS, 'package.json': PACKAGE_JSON },
      samples: ['src/api/users.ts'],
      structured: TWO_CANDIDATES,
    });
    const res = await (await app).inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const view = res.json();

    // The gate: two in, one out.
    expect(view.scan.candidates_raw).toBe(2);
    expect(view.scan.candidates_kept).toBe(1);
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0].evidence_path).toBe('src/api/users.ts');
    expect(view.candidates[0].status).toBe('pending');

    // The snippet is sliced off disk, not taken from the model.
    expect(view.candidates[0].evidence_snippet).toContain('const user = await db.users.find(id);');

    // package.json was read even though repo-intel never returns configs.
    expect(view.scan.config_count).toBe(1);
    expect(view.scan.sample_count).toBe(2);
    await (await app).close();
  });

  it('makes exactly ONE model call — sample selection is code-only', async () => {
    await clearConventions();
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: TWO_CANDIDATES },
    });
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      llm,
    });
    await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    expect((structuredCalls[0]!.req as { schemaName: string }).schemaName).toBe(
      'ConventionExtraction',
    );
    await app.close();
  });

  it('uses the per-scan model from the body and records it on the scan', async () => {
    await clearConventions();
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: { candidates: [] } },
    });
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      llm,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' },
    });
    expect(res.json().scan.model).toBe('z-ai/glm-4.7-flash');
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect((call!.req as { model: string }).model).toBe('z-ai/glm-4.7-flash');

    // A per-scan choice must NOT be persisted as the workspace default.
    const [row] = await pg.handle.db
      .select()
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    expect(row?.value ?? {}).not.toHaveProperty('conventions.model', 'z-ai/glm-4.7-flash');
    await app.close();
  });

  it('spends NO model call when nothing could be sampled', async () => {
    await clearConventions();
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: TWO_CANDIDATES },
    });
    const app = await makeApp({ files: {}, samples: [], llm });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().candidates).toHaveLength(0);
    expect(res.json().scan.sample_count).toBe(0);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
    await app.close();
  });

  it('rejects extraction with 422 when the repo has no clone yet', async () => {
    const [other] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'not-cloned',
        fullName: 'acme/not-cloned',
      })
      .returning();
    const app = await makeApp({ samples: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${other!.id}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    const scans = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, other!.id));
    expect(scans).toHaveLength(0);
    await app.close();
    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, other!.id));
  });

  it('PATCH sets edited=true and returns the updated DTO', async () => {
    await clearConventions();
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      structured: TWO_CANDIDATES,
    });
    const created = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    const id = created.candidates[0].id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { rule: 'Prefer async/await over promise chains in route handlers.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().edited).toBe(true);
    expect(res.json().rule).toContain('route handlers');
    await app.close();
  });

  it('PATCH on a foreign-workspace id → 404', async () => {
    const app = await makeApp({ samples: [] });
    const res = await app.inject({
      method: 'PATCH',
      url: '/conventions/11111111-1111-4111-8111-111111111111',
      payload: { status: 'accepted' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('bulk accept flips every pending row and leaves rejected ones alone', async () => {
    await clearConventions();
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      structured: {
        candidates: [
          TWO_CANDIDATES.candidates[0],
          {
            category: 'Validation',
            rule: 'Validate every request body with a zod schema before use.',
            evidence_path: 'src/api/users.ts',
            evidence_start_line: 1,
            evidence_end_line: 1,
            confidence: 0.8,
          },
        ],
      },
    });
    const created = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(created.candidates).toHaveLength(2);

    // Reject one explicitly, then "Accept all".
    const rejectedId = created.candidates[0].id as string;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${rejectedId}`,
      payload: { status: 'rejected' },
    });
    const bulk = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/bulk`,
      payload: { status: 'accepted' },
    });
    expect(bulk.json().updated).toBe(1);

    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    const statuses = Object.fromEntries(
      after.candidates.map((c: { id: string; status: string }) => [c.id, c.status]),
    );
    expect(statuses[rejectedId]).toBe('rejected');
    await app.close();
  });

  it('re-scan carries forward decided rows and drops stale pending ones', async () => {
    await clearConventions();
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      structured: TWO_CANDIDATES,
    });
    const first = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    const keptId = first.candidates[0].id as string;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${keptId}`,
      payload: { status: 'accepted' },
    });
    await app.close();

    // Second scan returns a DIFFERENT rule; the accepted one must survive.
    const app2 = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      structured: {
        candidates: [
          {
            category: 'Validation',
            rule: 'Validate every request body with a zod schema before use.',
            evidence_path: 'src/api/users.ts',
            evidence_start_line: 1,
            evidence_end_line: 1,
            confidence: 0.77,
          },
        ],
      },
    });
    const second = (
      await app2.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();

    const ids = second.candidates.map((c: { id: string }) => c.id);
    expect(ids).toContain(keptId); // the accepted row survived
    expect(second.candidates).toHaveLength(2);
    const carried = second.candidates.find((c: { id: string }) => c.id === keptId);
    expect(carried.status).toBe('accepted');
    // …and it was re-pointed at the new scan.
    expect(carried.scan_id).toBe(second.scan.id);
    await app2.close();
  });

  it('skill-draft merges only the accepted rules', async () => {
    await clearConventions();
    const app = await makeApp({
      files: { 'src/api/users.ts': USERS_TS },
      samples: ['src/api/users.ts'],
      structured: {
        candidates: [
          TWO_CANDIDATES.candidates[0],
          {
            category: 'Validation',
            rule: 'Validate every request body with a zod schema before use.',
            evidence_path: 'src/api/users.ts',
            evidence_start_line: 1,
            evidence_end_line: 1,
            confidence: 0.8,
          },
        ],
      },
    });
    const created = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    const acceptedId = created.candidates.find(
      (c: { category: string }) => c.category === 'Async',
    ).id as string;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${acceptedId}`,
      payload: { status: 'accepted' },
    });

    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();
    expect(draft.merged_count).toBe(1);
    expect(draft.slug).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.body).toContain('async/await');
    expect(draft.body).not.toContain('zod schema');
    expect(draft.evidence_files).toEqual(['src/api/users.ts']);
    await app.close();
  });

  it('the merged draft can be saved through POST /skills (disabled by the gate)', async () => {
    const app = await makeApp({ samples: [] });
    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        source: 'extracted',
        body: draft.body,
        evidence_files: draft.evidence_files,
      },
    });
    expect(res.statusCode).toBe(201);
    // The skills vetting gate forces this off for any non-'manual' source.
    expect(res.json().enabled).toBe(false);
    expect(res.json().version).toBe(1);
    await app.close();
  });
});
