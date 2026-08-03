import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the four built-in agents (General + Security +
 * Performance + Test Quality), all on the default openrouter/deepseek-v4-flash
 * provider+model, and four skills linked to the Test Quality Reviewer.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

// ---- Test Quality Reviewer skill bodies ------------------------------------
// These carry the CONCRETE, checkable rules on purpose -- the agent prompt
// (docs/agent-prompts/test-quality-reviewer.md / TEST_QUALITY_REVIEWER_PROMPT)
// stays deliberately generic ("review test quality") so a with-skills vs
// without-skills control experiment shows a real difference.

const TEST_COVERAGE_RUBRIC_BODY = `# Test Coverage Rubric

Use this rubric whenever a diff adds or changes a conditional branch, a new
function, or an error path.

## Rule

Every new or changed branch in the diff needs a test that exercises it
specifically — not just a test that happens to execute the surrounding
function on a path that skips the new branch.

## What counts as a "branch" here

- Each side of an \`if\`/\`else\`, ternary, or \`switch\` case.
- Each early return / guard clause (including the "nothing to do" case).
- Each \`catch\` block and each distinct thrown/rejected error.
- Each loop's zero-iteration case (empty input) as distinct from the
  one-or-more-iteration case.

## What to check for, in order

1. **List the branches the diff introduces or changes.** For each one, find
   the specific test (by file and test name) that exercises it.
2. **Boundary, empty, and error cases** get their own line item, not a single
   "happy path" test that is assumed to cover them by proxy.
3. **If a branch has no test**, name it precisely as \`file:line\` (the line of
   the branching condition, not the enclosing function) so the author can find
   it immediately.
4. **A test that executes a branch without asserting on its distinguishing
   output does not count as coverage for that branch** — see the Mocking
   Discipline skill for the related "assert behaviour, not execution" rule.

## Severity mapping

- An entirely untested new branch that can change externally-visible behaviour
  (a different return value, thrown error, HTTP status, or DB write) is a
  CRITICAL-level gap.
- A tested-but-weak branch (executed, weakly asserted) is a WARNING.
- A branch that is unreachable in practice or purely defensive (e.g. a
  \`should never happen\` guard) is at most a SUGGESTION to note, not a blocker.
`;

const EDGE_CASE_CHECKLIST_BODY = `# Edge Case Checklist

For every function or endpoint the diff changes, walk through this checklist
explicitly and say, for each item, whether it applies and whether it is
tested. Do not skip an item silently — if it does not apply, say so briefly.

## Checklist

1. **Empty** — empty string, empty array, empty object, empty request body.
2. **Null / undefined** — an optional field that is missing entirely vs.
   explicitly \`null\` vs. explicitly \`undefined\` (these are frequently handled
   inconsistently).
3. **Zero / falsy** — the number \`0\`, \`false\`, \`NaN\` — anywhere the code might
   confuse "falsy" with "absent" (e.g. \`if (!count)\` when \`count === 0\` is a
   valid, meaningful value).
4. **Boundary** — the first/last element of a collection, min/max of a numeric
   range, an off-by-one at a loop or pagination edge, a limit exactly at its
   cap vs. one over.
5. **Overflow / oversized input** — a string or array far larger than the
   typical case, a number near \`Number.MAX_SAFE_INTEGER\`, a deeply nested
   structure.
6. **Unicode / encoding** — multi-byte characters, emoji, combining characters,
   right-to-left text, anywhere the code slices, measures the length of, or
   truncates a string.
7. **Concurrency / ordering** — two callers racing on the same resource,
   out-of-order async completion, a retried or duplicated request (idempotency).

## How to report

- For each checklist item that is relevant to the changed code and has no
  corresponding test, that is a specific, citable gap — name the item and the
  file:line of the code path it would exercise.
- Do not turn this into a demand for one test per checklist item on every PR;
  only flag items that are actually plausible for the code being changed (a
  string-formatting helper does not need a concurrency test).
- An edge case that IS handled in code but has no test proving it is still a
  gap — the goal is a test that would fail if the handling were removed.
`;

const MOCKING_DISCIPLINE_BODY = `# Mocking Discipline

A convention for judging whether a test's mocking choices let it actually
catch regressions, or just let it pass.

## Rules

1. **Never mock the unit under test.** If a test mocks the very function,
   class, or module whose behaviour it claims to verify, it cannot fail when
   that behaviour breaks — it is testing the mock, not the code. Mocking is
   for the unit's *dependencies* (a DB client, an HTTP call, a filesystem), not
   the unit itself.
2. **Assert behaviour, not call counts.** A test that only checks
   \`expect(mockFn).toHaveBeenCalledTimes(1)\` or
   \`toHaveBeenCalledWith(...)\` without checking the resulting state, return
   value, or side effect visible to a caller is weak: it breaks on harmless
   refactors (e.g. splitting one call into two) and passes even when the
   overall behaviour is wrong. Call-count assertions are acceptable as a
   *supplement* to a behavioural assertion, never as the only assertion.
3. **A \`setTimeout\`-based wait is a flake, not a synchronization strategy.**
   Any test that waits a fixed duration (\`await sleep(200)\`,
   \`setTimeout(done, 500)\`) to "give async work time to finish" is
   nondeterministic under load and will eventually flake in CI. It should wait
   on a concrete signal instead — the resolved promise, a poll against a
   dedicated helper (e.g. this repo's \`waitForPrRuns\`), a fake-timer advance,
   or an event/callback — not a guessed duration.
4. **Over-mocking hides real defects.** If a test mocks so much of the
   surrounding system that the only thing left under test is glue code with no
   real logic, question whether it is worth the maintenance cost versus an
   integration-level test.

## How to report

- Name the specific mock and what it stands in for; explain concretely why it
  makes the test unable to catch a regression (rather than asserting this in
  the abstract).
- A test with a \`setTimeout\`/fixed-delay wait is a citable finding even if it
  currently passes — the point is that it is nondeterministic, not that it is
  currently failing.
`;

const IMPORTED_REVIEW_CHECKLIST_BODY = `---
name: Imported Review Checklist
description: A generic pull-request review checklist for general hygiene, imported from an external source and not yet vetted for this project.
type: custom
---

# Imported Review Checklist

A general-purpose PR review checklist, the kind commonly shared across teams.
This skill was imported and has not yet been reviewed for fit with this
project's own conventions — leave it disabled until someone vets it.

## Checklist

- Does the PR description explain *why*, not just *what*?
- Is the change scoped to one concern, or does it bundle unrelated fixes?
- Are commit messages meaningful on their own, without needing the PR
  description for context?
- Does the diff include tests for the behaviour it changes?
- Are there leftover debug statements, commented-out code, or TODOs that
  should have been resolved before opening the PR?
- Is any generated or vendored file accidentally hand-edited?
- Does the change need a changelog entry or version bump?

## Note

This checklist is intentionally generic — it is a stand-in for the kind of
content a team might pull in from a shared wiki or a public gist, to
demonstrate the import path rather than to add project-specific rules.
`;

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Reviews whether new/changed tests actually verify the changed behaviour.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- skills for the Test Quality Reviewer (demonstrates the skills feature) ----
  // Deliberate split with the agent prompt above: the prompt stays generic
  // ("review test quality"); the checkable rules below live ONLY here, so a
  // with-skills vs without-skills control experiment actually shows a
  // difference. See docs/agent-prompts/test-quality-reviewer.md.
  const [testQualityAgent] = await db
    .select()
    .from(t.agents)
    .where(
      and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')),
    );
  if (testQualityAgent) {
    const seedSkills: Array<{
      values: typeof t.skills.$inferInsert;
      order: number;
    }> = [
      {
        order: 0,
        values: {
          workspaceId,
          name: 'Test Coverage Rubric',
          description:
            'Requires every new branch introduced by the diff to have a test, with boundary/empty/error cases named explicitly and any uncovered branch cited as file:line.',
          type: 'rubric',
          source: 'manual',
          enabled: true,
          version: 1,
          body: TEST_COVERAGE_RUBRIC_BODY,
        },
      },
      {
        order: 1,
        values: {
          workspaceId,
          name: 'Edge Case Checklist',
          description:
            'A concrete checklist of edge-case categories (empty, null, zero, boundary, overflow, unicode, concurrency) the model must walk through explicitly for the changed code.',
          type: 'rubric',
          source: 'manual',
          enabled: true,
          version: 1,
          body: EDGE_CASE_CHECKLIST_BODY,
        },
      },
      {
        order: 2,
        values: {
          workspaceId,
          name: 'Mocking Discipline',
          description:
            'Flags tests that mock the unit under test, assert call counts instead of behaviour, or rely on setTimeout-based waits instead of deterministic synchronization.',
          type: 'convention',
          source: 'manual',
          enabled: true,
          version: 1,
          body: MOCKING_DISCIPLINE_BODY,
        },
      },
      {
        order: 3,
        values: {
          workspaceId,
          name: 'Imported Review Checklist',
          description:
            'A generic PR review checklist pulled in from an external source. Disabled until vetted — sample of a skill that arrived via import rather than being authored in-app.',
          type: 'custom',
          source: 'imported_url',
          enabled: false,
          version: 1,
          evidenceFiles: ['SKILL.md'],
          body: IMPORTED_REVIEW_CHECKLIST_BODY,
        },
      },
    ];

    for (const { values, order } of seedSkills) {
      let [existingSkill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, values.name)));
      if (!existingSkill) {
        [existingSkill] = await db.insert(t.skills).values(values).returning();
        // Seed writes t.skills directly, bypassing SkillsRepository.insert (which
        // would normally snapshot v1) -- record the v1 body snapshot explicitly so
        // skill_versions isn't empty and a future "v1" chip isn't a lie.
        await db
          .insert(t.skillVersions)
          .values({ skillId: existingSkill!.id, version: 1, body: existingSkill!.body })
          .onConflictDoNothing();
      }

      await db
        .insert(t.agentSkills)
        .values({ agentId: testQualityAgent.id, skillId: existingSkill!.id, order })
        .onConflictDoNothing();
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint. pathToFileURL, not `file://${argv[1]}` -- on Windows argv[1]
// is a backslashed drive path that never matches import.meta.url's file:///D:/…
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
