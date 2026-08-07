import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

/**
 * smart-diff — end to end against a seeded PR spanning all three roles plus a
 * review with findings. `*.it.test.ts` — DB-backed, skipped without Docker.
 *
 * `LocalNoAuthProvider` always resolves the seeded default workspace (see
 * `db/seed.ts#DEFAULT_WORKSPACE_NAME`), so `seed()` runs first and every
 * fixture below hangs off ITS workspace/repo — a second, unrelated workspace
 * is what proves the 404 scoping.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

d('smart-diff module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;
  let defaultRepoId: string;
  let prId: string;
  let noFindingsPrId: string;
  let otherWorkspacePrId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    await seed(db);

    const [repo] = await db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    defaultRepoId = repo!.id;
    defaultWorkspaceId = repo!.workspaceId;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: defaultWorkspaceId,
        repoId: defaultRepoId,
        number: 9001,
        title: 'Smart diff fixture PR',
        author: 'seed',
        branch: 'feat/smart-diff',
        base: 'main',
        headSha: 'abc123',
      })
      .returning();
    prId = pr!.id;

    // One file per role: core, wiring, boilerplate.
    await db.insert(t.prFiles).values([
      { prId, path: 'src/modules/foo/service.ts', additions: 50, deletions: 10 },
      { prId, path: 'src/modules/foo/routes.ts', additions: 20, deletions: 5 },
      { prId, path: 'pnpm-lock.yaml', additions: 500, deletions: 0 },
    ]);

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId: defaultWorkspaceId,
        prId,
        agentId: null,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'fixture review',
        score: 50,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/modules/foo/service.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'fixture finding',
        rationale: 'fixture',
        confidence: 0.9,
      },
      {
        reviewId: review!.id,
        file: 'src/modules/foo/routes.ts',
        startLine: 3,
        endLine: 3,
        severity: 'WARNING',
        category: 'style',
        title: 'fixture finding 2',
        rationale: 'fixture',
        confidence: 0.7,
      },
    ]);

    // A second PR (same workspace) with no findings at all.
    const [pr2] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: defaultWorkspaceId,
        repoId: defaultRepoId,
        number: 9002,
        title: 'Smart diff fixture PR (no findings)',
        author: 'seed',
        branch: 'feat/smart-diff-2',
        base: 'main',
        headSha: 'def456',
      })
      .returning();
    noFindingsPrId = pr2!.id;
    await db
      .insert(t.prFiles)
      .values([{ prId: noFindingsPrId, path: 'src/modules/bar/service.ts', additions: 10, deletions: 0 }]);

    // A PR in a DIFFERENT workspace — must 404 under the default-workspace context.
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'smart-diff-other-ws' }).returning();
    const [otherUser] = await db
      .insert(t.users)
      .values({ email: 'smart-diff-other@example.com', name: 'Other Workspace User' })
      .returning();
    const [otherRepo] = await db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'other-repo',
        fullName: 'other/other-repo',
        createdBy: otherUser!.id,
      })
      .returning();
    const [otherPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Other workspace PR',
        author: 'seed',
        branch: 'feat/other',
        base: 'main',
        headSha: 'fff000',
      })
      .returning();
    otherWorkspacePrId = otherPr!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db });
  }

  it('response parses and groups are in order', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups.map((g: { role: string }) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups[0].files).toHaveLength(1);
    expect(body.groups[0].files[0].path).toBe('src/modules/foo/service.ts');
    expect(body.groups[1].files[0].path).toBe('src/modules/foo/routes.ts');
    expect(body.groups[2].files[0].path).toBe('pnpm-lock.yaml');
    await app.close();
  });

  it('finding_marks carry the right severities and non-empty finding_id/review_id', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    const body = res.json();
    const coreFile = body.groups[0].files[0];
    expect(coreFile.finding_marks).toHaveLength(1);
    expect(coreFile.finding_marks[0].severity).toBe('CRITICAL');
    expect(coreFile.finding_marks[0].finding_id).toBeTruthy();
    expect(coreFile.finding_marks[0].review_id).toBeTruthy();

    const wiringFile = body.groups[1].files[0];
    expect(wiringFile.finding_marks).toHaveLength(1);
    expect(wiringFile.finding_marks[0].severity).toBe('WARNING');
    await app.close();
  });

  it('finding_lines matches the finding_marks lines', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    const body = res.json();
    const coreFile = body.groups[0].files[0];
    expect(coreFile.finding_lines).toEqual([12]);
    await app.close();
  });

  it('a PR in another workspace returns 404', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${otherWorkspacePrId}/smart-diff` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('a PR with no findings gives every file finding_count: 0', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${noFindingsPrId}/smart-diff` });
    const body = res.json();
    const allFiles = body.groups.flatMap((g: { files: { finding_count: number }[] }) => g.files);
    expect(allFiles.length).toBeGreaterThan(0);
    for (const f of allFiles) {
      expect(f.finding_count).toBe(0);
    }
    await app.close();
  });
});
