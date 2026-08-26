import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitHubClient, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { RepoIntel, BlastResult, IndexState } from '../repo-intel/types.js';
import type { PrBrief } from '@devdigest/shared';
import { MAX_BRIEF_HISTORY } from './constants.js';

/**
 * brief module — end to end against a seeded PR (`brief.it.test.ts`: the
 * filename is what puts this in the DB lane, not `test/`'s directory). Docker
 * required — skipped cleanly without it.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const DIFF = `diff --git a/src/modules/payments/service.ts b/src/modules/payments/service.ts
--- a/src/modules/payments/service.ts
+++ b/src/modules/payments/service.ts
@@ -10,3 +10,4 @@
   charge(amount) {
+    validateAmount(amount);
   },`;

const BRIEF_FIXTURE: PrBrief = {
  what: 'Adds amount validation to the payments charge path.',
  why: 'Prevents negative or zero-amount charges from reaching the processor.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'validation',
      title: 'Missing bound on validateAmount',
      explanation: 'No upper bound is enforced.',
      severity: 'medium',
      file_refs: ['src/modules/payments/service.ts'],
    },
  ],
  review_focus: [
    { file: 'src/modules/payments/service.ts', line: 11, reason: 'New validation call' },
  ],
};

function stubRepoIntel(overrides: Partial<BlastResult> = {}, indexState: Partial<IndexState> = {}): RepoIntel {
  const blastResult: BlastResult = {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
  const state: IndexState = {
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 5,
    repoId: 'stub',
    lastIndexedSha: 'a1b2c3d4',
    indexerVersion: 1,
    updatedAt: new Date(),
    ...indexState,
  };
  return {
    getBlastRadius: async () => blastResult,
    getIndexState: async () => state,
  } as unknown as RepoIntel;
}

/** repoIntel stub whose getBlastRadius/getIndexState both reject — simulates
 *  blast being entirely unavailable (AC-36). */
function failingRepoIntel(): RepoIntel {
  return {
    getBlastRadius: async () => {
      throw new Error('index unreachable');
    },
    getIndexState: async () => {
      throw new Error('index unreachable');
    },
  } as unknown as RepoIntel;
}

d('brief module (Testcontainers pg)', () => {
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

  async function setupRepoAndPr(headSha = 'a1b2c3d4', opts: { withPrFiles?: boolean } = {}) {
    const { withPrFiles = true } = opts;
    const name = `brief-fixture-${repoSeq++}`;
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
        title: 'Validate charge amount',
        author: 'dev',
        branch: 'feat/validate-amount',
        base: 'main',
        headSha,
        body: 'Adds validation. Closes #123.',
      })
      .returning();
    // `blast/repository.ts#getPrFiles` reads THIS table (not the mock diff) to
    // decide whether to call repoIntel at all — a PR with no pr_files rows is
    // blast's own "changed nothing" short-circuit and never reaches repoIntel,
    // which would silently defeat the failingRepoIntel() fixtures below.
    // `withPrFiles: false` (used to prove AC-28's `indexed_sha: null` case) skips
    // this insert on purpose, so `BlastService#forPull` takes that early-return
    // path and reports `indexed_sha: null` regardless of `stubRepoIntel`'s index
    // state — `doGenerate` still proceeds because `loadDiff` prefers the mock
    // git client's diff over `pr_files` reconstruction.
    if (withPrFiles) {
      await pg.handle.db.insert(t.prFiles).values({
        prId: pr!.id,
        path: 'src/modules/payments/service.ts',
        additions: 1,
        deletions: 0,
        patch: '@@ -10,3 +10,4 @@\n   charge(amount) {\n+    validateAmount(amount);\n   },',
      });
    }
    return { repo: repo!, pr: pr! };
  }

  function makeApp(opts: {
    structured?: unknown;
    repoIntel?: RepoIntel;
    diff?: string;
    files?: Record<string, string>;
  }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const llm = new MockLLMProvider('openai', { structuredBySchema: { PrBrief: opts.structured ?? BRIEF_FIXTURE } });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: opts.diff ?? DIFF, files: opts.files ?? {} }),
        github: new MockGitHubClient(),
        repoIntel: opts.repoIntel ?? stubRepoIntel(),
        llm: { openai: llm },
      },
    });
  }

  it('GET returns null for a PR with no stored brief', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({});
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('POST generates and persists a brief; GET then reflects it as current (AC-29, AC-27)', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({});

    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    const genBody = gen.json();
    expect(genBody.what).toBe(BRIEF_FIXTURE.what);
    expect(genBody.provenance.head_sha).toBe('a1b2c3d4');

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.statusCode).toBe(200);
    const readBody = read.json();
    expect(readBody.is_current).toBe(true);
    expect(readBody.what).toBe(BRIEF_FIXTURE.what);
  });

  it('regenerating REPLACES the stored brief rather than accumulating (AC-31)', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({});

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    const second: PrBrief = { ...BRIEF_FIXTURE, what: 'Second generation replaces the first.' };
    const app2 = await makeApp({ structured: second });
    const gen2 = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen2.statusCode).toBe(201);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(gen2.json().what).toBe('Second generation replaces the first.');
  });

  it('a failed generation leaves the previously stored brief intact (AC-40, AC-59)', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({});
    const gen1 = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen1.statusCode).toBe(201);

    // A fixture that fails PrBrief's own schema (missing every required field)
    // makes MockLLMProvider#completeStructured throw — simulating a model
    // failure after retries, which `service.ts` turns into brief_generation_failed.
    const failingApp = await makeApp({ structured: { totally: 'not a brief' } });
    const gen2 = await failingApp.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen2.statusCode).toBe(502);
    expect(gen2.json().error.code).toBe('brief_generation_failed');

    const read = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.json().what).toBe(BRIEF_FIXTURE.what);
  });

  it('records the selected document set and any rejected reference entries (AC-18, AC-23)', async () => {
    const { pr } = await setupRepoAndPr();
    const badFixture: PrBrief = {
      ...BRIEF_FIXTURE,
      risks: [
        {
          kind: 'invented',
          title: 'References a file never in this diff',
          explanation: 'bogus',
          severity: 'low',
          file_refs: ['src/never/touched.ts'],
        },
      ],
    };
    const app = await makeApp({
      structured: badFixture,
      files: { 'docs/payments.md': 'Payments architecture notes.' },
    });
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    const body = gen.json();
    // The invented risk is dropped whole, and recorded why.
    expect(body.risks).toEqual([]);
    expect(body.provenance.rejected_entries).toHaveLength(1);
    expect(body.provenance.rejected_entries[0].reason).toMatch(/unknown file/);
  });

  it('the second concurrent generation request for the SAME pr is rejected (AC-58)', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({});
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` }),
      app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const conflict = first.statusCode === 409 ? first : second;
    expect(conflict.json().error.code).toBe('conflict');
  });

  it('degrades gracefully with blast unavailable, recording a missing_inputs entry (AC-36)', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp({ repoIntel: failingRepoIntel() });
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    const body = gen.json();
    expect(body.provenance.missing_inputs.some((m: string) => m.includes('blast'))).toBe(true);
  });

  it('degrades gracefully with intent absent, recording a missing_inputs entry (AC-35)', async () => {
    const { pr } = await setupRepoAndPr();
    // No pr_intent row was ever inserted for this PR.
    const app = await makeApp({});
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    const body = gen.json();
    expect(body.provenance.missing_inputs.some((m: string) => m.includes('intent'))).toBe(true);
  });

  it('degrades gracefully with the linked issue unfetchable, recording a missing_inputs entry (AC-38)', async () => {
    const { pr } = await setupRepoAndPr();
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const llm = new MockLLMProvider('openai', { structuredBySchema: { PrBrief: BRIEF_FIXTURE } });
    // Subclass rather than spread — `{ ...new MockGitHubClient(), getIssue: fn }`
    // only copies OWN enumerable properties and silently drops every
    // prototype method (server/INSIGHTS.md), which is exactly what surfaces
    // as this file's own `arch:check`-independent typecheck failure.
    class FailingIssueGitHubClient extends MockGitHubClient {
      override async getIssue(): Promise<never> {
        throw new Error('issue fetch failed');
      }
    }
    const failingGithub = new FailingIssueGitHubClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: failingGithub,
        repoIntel: stubRepoIntel(),
        llm: { openai: llm },
      },
    });
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    const body = gen.json();
    expect(body.provenance.missing_inputs.some((m: string) => m.includes('issue'))).toBe(true);
  });

  it('persists a costUsd of exactly 0 as 0, not null (AC-7)', async () => {
    const { pr } = await setupRepoAndPr();
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const zeroCostLlm = new MockLLMProvider('openai', { structuredBySchema: { PrBrief: BRIEF_FIXTURE } });
    // Override completeStructured to report an exact-zero cost, distinct from
    // "unknown" — MockLLMProvider's default 0.001 would mask this assertion.
    zeroCostLlm.completeStructured = async (req) => {
      const parsed = (req.schema as { parse: (v: unknown) => unknown }).parse(BRIEF_FIXTURE);
      return {
        data: parsed,
        model: req.model,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0,
        costSource: 'exact',
        raw: JSON.stringify(BRIEF_FIXTURE),
        attempts: 1,
      } as never;
    };
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        repoIntel: stubRepoIntel(),
        llm: { openai: zeroCostLlm },
      },
    });
    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen.statusCode).toBe(201);
    expect(gen.json().provenance.cost_usd).toBe(0);
  });

  it('a PR whose head sha changes mid-flight is still stored against the sha captured at generation start (AC-33)', async () => {
    const { pr, repo } = await setupRepoAndPr('head-at-start');
    const app = await makeApp({});
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });

    // Simulate a push landing mid-review: the PR row's head sha changes AFTER
    // generation already captured the original value.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'head-after-push' })
      .where(eq(t.pullRequests.id, pr.id));

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows[0]?.headSha).toBe('head-at-start');
    void repo;
  });

  it('GET /pulls/:id/brief/timeline returns 2 entries newest-first after a head-sha change, and GET /brief still returns the newest (Why Timeline, 0003)', async () => {
    const { pr } = await setupRepoAndPr('sha-one');
    const app = await makeApp({});

    const gen1 = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen1.statusCode).toBe(201);

    // A force-push: the PR's head sha moves to a new commit before the next
    // generation, which is what makes the second generation APPEND rather
    // than replace (repository.ts#upsertBrief's composite conflict target).
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'sha-two' }).where(eq(t.pullRequests.id, pr.id));
    const second: PrBrief = { ...BRIEF_FIXTURE, what: 'Second generation, second commit.' };
    const app2 = await makeApp({ structured: second });
    const gen2 = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen2.statusCode).toBe(201);

    const timeline = await app2.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    expect(timeline.statusCode).toBe(200);
    const entries = timeline.json().entries;
    expect(entries).toHaveLength(2);
    // Newest first.
    expect(entries[0].head_sha).toBe('sha-two');
    expect(entries[0].is_current).toBe(true);
    expect(entries[1].head_sha).toBe('sha-one');
    expect(entries[1].is_current).toBe(false);

    const read = await app2.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(read.statusCode).toBe(200);
    expect(read.json().provenance.head_sha).toBe('sha-two');
    expect(read.json().what).toBe('Second generation, second commit.');
  });

  it('a second generation at the SAME head sha and indexed_sha leaves the timeline count at 2 (same-key replace, AC-31 preserved)', async () => {
    const { pr } = await setupRepoAndPr('sha-one');
    const app = await makeApp({});
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'sha-two' }).where(eq(t.pullRequests.id, pr.id));
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });

    // A third generation at the SAME head sha (`sha-two`) and the same
    // `indexed_sha` (both generations here use the default `stubRepoIntel`)
    // replaces the second row in place rather than appending a third.
    const third: PrBrief = { ...BRIEF_FIXTURE, what: 'Regenerated at the same commit.' };
    const app3 = await makeApp({ structured: third });
    const gen3 = await app3.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen3.statusCode).toBe(201);

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(2);

    const timeline = await app3.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    const entries = timeline.json().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].head_sha).toBe('sha-two');
  });

  it(`retains at most MAX_BRIEF_HISTORY (${MAX_BRIEF_HISTORY}) rows after generating past that many distinct head shas`, async () => {
    const { pr } = await setupRepoAndPr('sha-0');
    const app = await makeApp({});
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });

    // Generate against MAX_BRIEF_HISTORY + 3 MORE distinct head shas — well
    // past the retention cap — so the prune-on-generate path (service.ts's
    // `doGenerate` calling `repo.pruneBriefs` right after `upsertBrief`) must
    // trim, not just happen to land under the cap by coincidence.
    for (let i = 1; i <= MAX_BRIEF_HISTORY + 3; i++) {
      await pg.handle.db
        .update(t.pullRequests)
        .set({ headSha: `sha-${i}` })
        .where(eq(t.pullRequests.id, pr.id));
      const gen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
      expect(gen.statusCode).toBe(201);
    }

    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(MAX_BRIEF_HISTORY);

    const timeline = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    const entries = timeline.json().entries;
    expect(entries).toHaveLength(MAX_BRIEF_HISTORY);
    // The newest MAX_BRIEF_HISTORY shas survive; the oldest ones (`sha-0`,
    // `sha-1`, `sha-2`) were pruned.
    expect(entries[0].head_sha).toBe(`sha-${MAX_BRIEF_HISTORY + 3}`);
    expect(entries.map((e: { head_sha: string }) => e.head_sha)).not.toContain('sha-0');
  });

  it('a brief stored with indexed_sha: null is never reported current once an index exists (AC-28 survives the indexed_sha_key translation)', async () => {
    // No pr_files row: BlastService#forPull's own "changed nothing" early
    // return reports `indexed_sha: null` regardless of stubRepoIntel's index
    // state — the ONE way to get a real generation stored with a null index
    // leg of the cache key without mocking BlastService directly (out of
    // scope for brief's own deps, which only take a structural `blastReader`
    // port for the CURRENT indexed_sha, never a repository double).
    const { pr } = await setupRepoAndPr('sha-null-index', { withPrFiles: false });
    const app = await makeApp({});
    const gen1 = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen1.statusCode).toBe(201);
    expect(gen1.json().provenance.indexed_sha).toBeNull();

    const timelineBefore = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    const beforeEntries = timelineBefore.json().entries;
    expect(beforeEntries).toHaveLength(1);
    expect(beforeEntries[0].indexed_sha).toBeNull();
    expect(beforeEntries[0].is_current).toBe(true);

    // Now a second row is generated for the SAME pr_id but WITH a pr_files
    // row present, so the index leg resolves to a real sha (`stubRepoIntel`'s
    // default `lastIndexedSha`) instead of null — this is what makes the
    // FIRST (null-indexed) row's currency false once "an index exists", per
    // AC-28, without touching the null row itself.
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr.id,
      path: 'src/modules/payments/service.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   charge(amount) {\n+    validateAmount(amount);\n   },',
    });
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'sha-with-index' })
      .where(eq(t.pullRequests.id, pr.id));
    const second: PrBrief = { ...BRIEF_FIXTURE, what: 'Second generation, now indexed.' };
    const app2 = await makeApp({ structured: second });
    const gen2 = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/generate` });
    expect(gen2.statusCode).toBe(201);
    expect(gen2.json().provenance.indexed_sha).not.toBeNull();

    const timelineAfter = await app2.inject({ method: 'GET', url: `/pulls/${pr.id}/brief/timeline` });
    const afterEntries: { head_sha: string; indexed_sha: string | null; is_current: boolean }[] =
      timelineAfter.json().entries;
    expect(afterEntries).toHaveLength(2);
    const nullIndexEntry = afterEntries.find((e) => e.head_sha === 'sha-null-index');
    expect(nullIndexEntry).toBeDefined();
    expect(nullIndexEntry?.indexed_sha).toBeNull();
    // The old null-indexed row must NOT be reported current now that an index
    // exists — `===` on `null` both sides (service.ts#getTimeline) means it
    // only ever matched a PR that ALSO currently has no index.
    expect(nullIndexEntry?.is_current).toBe(false);
  });
});
