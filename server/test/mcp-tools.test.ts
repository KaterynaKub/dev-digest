import { describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  McpToolsService,
  AgentNotFoundError,
  RepoNotFoundError,
  RepoFormatError,
  PullNotFoundError,
  NoReviewYetError,
  type McpToolsDeps,
  type AgentRowLike,
} from '../src/modules/mcp-tools/service.js';
import { createMcpServer } from '../src/mcp/server-factory.js';
import { TOOL_NAMES } from '../src/modules/mcp-tools/constants.js';
import type { BlastRadius } from '@devdigest/shared';

function agent(overrides: Partial<AgentRowLike> = {}): AgentRowLike {
  return {
    id: 'agent-1',
    name: 'Reviewer',
    provider: 'openai',
    model: 'gpt-5',
    enabled: true,
    ciFailOn: 'critical',
    ...overrides,
  };
}

function baseDeps(overrides: Partial<McpToolsDeps> = {}): McpToolsDeps {
  return {
    agentsRepo: {
      list: vi.fn(async () => [agent()]),
      getById: vi.fn(async () => undefined),
    },
    reviewRepo: {
      findPullByNumber: vi.fn(async () => undefined),
    },
    repoRepo: {
      findByFullName: vi.fn(async () => undefined),
    },
    reviewRunner: {
      resolveTargets: vi.fn(async () => [agent()]),
      runReviewAndWait: vi.fn(async () => ({ runs: [], timedOut: false, reviews: [] })),
      reviewsForPull: vi.fn(async () => []),
    },
    conventionsReader: {
      view: vi.fn(async () => ({ scan: null, candidates: [] })),
    },
    blastReader: {
      forPull: vi.fn(async () => blastRadius()),
    },
    workspaceId: vi.fn(async () => 'ws-1'),
    ...overrides,
  };
}

/** A `full`-index, empty-downstream map — the "nothing calls this" answer. */
function blastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [],
    downstream: [],
    summary: 'No changed symbols detected.',
    index_status: 'full',
    degraded: false,
    reason: null,
    indexed_sha: 'abc123',
    index_stale: false,
    ...overrides,
  };
}

describe('McpToolsService', () => {
  describe('listAgents', () => {
    it('maps agent rows through toMcpAgent', async () => {
      const service = new McpToolsService(baseDeps());
      const agents = await service.listAgents();
      expect(agents).toEqual([
        { id: 'agent-1', name: 'Reviewer', provider: 'openai', model: 'gpt-5', enabled: true },
      ]);
    });
  });

  describe('runAgentOnPr', () => {
    it('throws AgentNotFoundError for an unknown agent id', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        agentsRepo: { list: vi.fn(async () => []), getById: vi.fn(async () => undefined) },
      });
      const service = new McpToolsService(deps);
      await expect(service.runAgentOnPr('acme/payments-api', 42, 'ghost')).rejects.toBeInstanceOf(
        AgentNotFoundError,
      );
    });

    it('throws RepoFormatError for an unrecognized repo string', async () => {
      const service = new McpToolsService(baseDeps());
      await expect(service.runAgentOnPr('payments-api', 1, undefined)).rejects.toBeInstanceOf(
        RepoFormatError,
      );
    });

    it('throws RepoNotFoundError when the repo is not connected', async () => {
      const deps = baseDeps({ repoRepo: { findByFullName: vi.fn(async () => undefined) } });
      const service = new McpToolsService(deps);
      await expect(service.runAgentOnPr('acme/payments-api', 1, undefined)).rejects.toBeInstanceOf(
        RepoNotFoundError,
      );
    });

    it('throws PullNotFoundError when the PR does not exist in a connected repo', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => undefined) },
      });
      const service = new McpToolsService(deps);
      await expect(service.runAgentOnPr('acme/payments-api', 999, undefined)).rejects.toBeInstanceOf(
        PullNotFoundError,
      );
    });

    it('runs every enabled agent when agent is omitted', async () => {
      const resolveTargets = vi.fn(async () => [agent({ id: 'a1' }), agent({ id: 'a2' })]);
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        reviewRunner: {
          resolveTargets,
          runReviewAndWait: vi.fn(async () => ({
            runs: [
              { run_id: 'run1', agent_id: 'a1', agent_name: 'Reviewer' },
              { run_id: 'run2', agent_id: 'a2', agent_name: 'Reviewer' },
            ],
            timedOut: false,
            reviews: [
              { agent_id: 'a1', run_id: 'run1', findings: [] },
              { agent_id: 'a2', run_id: 'run2', findings: [] },
            ],
          })),
          reviewsForPull: vi.fn(async () => []),
        },
      });
      const service = new McpToolsService(deps);
      const result = await service.runAgentOnPr('acme/payments-api', 1, undefined);
      expect(resolveTargets).toHaveBeenCalledWith('ws-1', { all: true });
      expect(result.agents).toHaveLength(2);
      expect(result.agents.every((a) => a.status === 'done')).toBe(true);
      expect(result.run_status).toBe('completed');
    });

    it('marks a run cancelled when its review never landed (timeout)', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        agentsRepo: { list: vi.fn(async () => [agent()]), getById: vi.fn(async () => agent()) },
        reviewRunner: {
          resolveTargets: vi.fn(async () => [agent()]),
          runReviewAndWait: vi.fn(async () => ({
            runs: [{ run_id: 'run1', agent_id: 'agent-1', agent_name: 'Reviewer' }],
            timedOut: true,
            reviews: [],
          })),
          reviewsForPull: vi.fn(async () => []),
        },
      });
      const service = new McpToolsService(deps);
      const result = await service.runAgentOnPr('acme/payments-api', 1, 'agent-1');
      expect(result.run_status).toBe('timed_out');
      expect(result.agents).toEqual([{ agent_id: 'agent-1', agent_name: 'Reviewer', status: 'cancelled' }]);
    });
  });

  describe('getFindings', () => {
    it('throws NoReviewYetError when the PR has no persisted reviews', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        reviewRunner: {
          resolveTargets: vi.fn(async () => []),
          runReviewAndWait: vi.fn(async () => ({ runs: [], timedOut: false, reviews: [] })),
          reviewsForPull: vi.fn(async () => []),
        },
      });
      const service = new McpToolsService(deps);
      await expect(service.getFindings('acme/payments-api', 1, 'CONCISE')).rejects.toBeInstanceOf(
        NoReviewYetError,
      );
    });
  });

  describe('getConventions', () => {
    it('maps the conventions view into the MCP shape', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        conventionsReader: {
          view: vi.fn(async () => ({
            scan: { created_at: '2026-08-01T00:00:00.000Z' },
            candidates: [{ category: 'naming', rule: 'use camelCase', evidence_path: 'src/a.ts' }],
          })),
        },
      });
      const service = new McpToolsService(deps);
      const result = await service.getConventions('acme/payments-api');
      expect(result.total).toBe(1);
      expect(result.scanned_at).toBe('2026-08-01T00:00:00.000Z');
      expect(result.conventions).toEqual([
        { category: 'naming', rule: 'use camelCase', evidence_path: 'src/a.ts' },
      ]);
    });
  });

  describe('getBlastRadius', () => {
    it('resolves repo+pr to prId and returns the reader\'s map untouched', async () => {
      const map = blastRadius({
        changed_symbols: [{ name: 'chargeCard', file: 'src/billing.ts', kind: 'function' }],
        summary: '1 changed symbol · no downstream callers found.',
      });
      const forPull = vi.fn(async () => map);
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        blastReader: { forPull },
      });
      const service = new McpToolsService(deps);

      const result = await service.getBlastRadius('https://github.com/acme/payments-api', 7);

      expect(forPull).toHaveBeenCalledWith('ws-1', 'pr1');
      // Untouched: no summarising, no re-shaping — same object the HTTP route serves.
      expect(result).toBe(map);
    });

    it('throws RepoNotFoundError before ever reading the index', async () => {
      const forPull = vi.fn(async () => blastRadius());
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => undefined) },
        blastReader: { forPull },
      });
      const service = new McpToolsService(deps);
      await expect(service.getBlastRadius('acme/payments-api', 7)).rejects.toBeInstanceOf(
        RepoNotFoundError,
      );
      expect(forPull).not.toHaveBeenCalled();
    });

    // Blast reads the code index, not a review — unlike get_findings it must
    // answer for a PR nobody has reviewed rather than raising NoReviewYetError.
    it('serves a PR that has never been reviewed', async () => {
      const deps = baseDeps({
        repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
        reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
        reviewRunner: {
          resolveTargets: vi.fn(async () => []),
          runReviewAndWait: vi.fn(async () => ({ runs: [], timedOut: false, reviews: [] })),
          reviewsForPull: vi.fn(async () => []), // no review has ever run
        },
      });
      const service = new McpToolsService(deps);
      await expect(service.getBlastRadius('acme/payments-api', 7)).resolves.toMatchObject({
        index_status: 'full',
      });
    });
  });
});

describe('MCP protocol wiring (tools/list, tools/call)', () => {
  async function connectedClient(deps: McpToolsDeps) {
    const service = new McpToolsService(deps);
    const server = createMcpServer(service);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { client, server };
  }

  it('lists exactly 5 tools in the fixed TOOL_NAMES order', async () => {
    const { client, server } = await connectedClient(baseDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    await client.close();
    await server.close();
  });

  it('each tool carries the annotations from Step 6', async () => {
    const { client, server } = await connectedClient(baseDeps());
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('list_agents')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.get('run_agent_on_pr')?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(byName.get('get_findings')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.get('get_conventions')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.get('get_blast_radius')?.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });
    await client.close();
    await server.close();
  });

  it('an unknown agent id error text names list_agents (principle #4)', async () => {
    const deps = baseDeps({
      repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
      reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
      agentsRepo: { list: vi.fn(async () => []), getById: vi.fn(async () => undefined) },
    });
    const { client, server } = await connectedClient(deps);
    const res = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo: 'acme/payments-api', pr: 1, agent: 'ghost-id' },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('list_agents');
    await client.close();
    await server.close();
  });

  it('an unrecognized repo format error text names the expected formats', async () => {
    const { client, server } = await connectedClient(baseDeps());
    const res = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'payments-api', pr: 1 },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('owner/name');
    await client.close();
    await server.close();
  });

  it('get_blast_radius serves the resolved PR\'s map and is no longer a stub', async () => {
    const forPull = vi.fn(async () =>
      blastRadius({
        changed_symbols: [{ name: 'chargeCard', file: 'src/billing.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'chargeCard',
            callers: [{ name: 'checkout', file: 'src/api/checkout.ts', line: 42 }],
            endpoints_affected: ['POST /api/checkout'],
            crons_affected: [],
          },
        ],
        summary: '1 changed symbol · 1 caller across 1 file · 1 endpoint',
      }),
    );
    const deps = baseDeps({
      repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
      reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
      blastReader: { forPull },
    });
    const { client, server } = await connectedClient(deps);
    const res = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 7 },
    });

    expect(res.isError).toBeFalsy();
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text.startsWith('STUB:')).toBe(false);
    // The PR was resolved to its internal id before the map was read.
    expect(forPull).toHaveBeenCalledWith('ws-1', 'pr1');
    expect(res.structuredContent).toMatchObject({
      downstream: [
        {
          symbol: 'chargeCard',
          callers: [{ name: 'checkout', file: 'src/api/checkout.ts', line: 42 }],
          endpoints_affected: ['POST /api/checkout'],
        },
      ],
      index_status: 'full',
      degraded: false,
    });
    await client.close();
    await server.close();
  });

  // KEY NEGATIVE TEST — the MCP mirror of `blast-helpers.test.ts`'s. An empty
  // `downstream` must NOT reach the model as the same answer in both index
  // states: on a full index it means "nothing calls this", on a failed one it
  // means "we do not know". Flattening the two would let a model report an
  // unmeasured blast radius as a safe one.
  it('an empty downstream on a degraded index is NOT the same payload as on a full one', async () => {
    const base = {
      repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
      reviewRepo: { findPullByNumber: vi.fn(async () => ({ prId: 'pr1', repoId: 'r1', headSha: 'sha' })) },
    };
    const call = async (radius: BlastRadius) => {
      const { client, server } = await connectedClient(
        baseDeps({ ...base, blastReader: { forPull: vi.fn(async () => radius) } }),
      );
      const res = await client.callTool({
        name: 'get_blast_radius',
        arguments: { repo: 'acme/payments-api', pr: 7 },
      });
      await client.close();
      await server.close();
      return res;
    };

    const full = await call(blastRadius({ summary: '2 changed symbols · no downstream callers found.' }));
    const failed = await call(
      blastRadius({
        summary: 'Index not built — downstream unavailable.',
        index_status: 'failed',
        degraded: true,
        reason: 'index_failed',
      }),
    );

    // Both carry an equally empty downstream…
    expect(full.structuredContent).toMatchObject({ downstream: [] });
    expect(failed.structuredContent).toMatchObject({ downstream: [] });
    // …and are still distinguishable in every field that encodes WHY.
    expect(full.structuredContent).toMatchObject({
      index_status: 'full',
      degraded: false,
      reason: null,
    });
    expect(failed.structuredContent).toMatchObject({
      index_status: 'failed',
      degraded: true,
      reason: 'index_failed',
    });
    expect(full.structuredContent?.summary).not.toEqual(failed.structuredContent?.summary);
    // The text duplicate carries the same distinction — a client without
    // structuredContent support must not lose it.
    const textOf = (res: typeof full) => (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(textOf(failed)).toContain('"index_status":"failed"');
    expect(textOf(full)).toContain('"index_status":"full"');
  });

  it('get_blast_radius maps an unknown PR to the pull-not-found text, never an empty map', async () => {
    const deps = baseDeps({
      repoRepo: { findByFullName: vi.fn(async () => ({ id: 'r1', fullName: 'acme/payments-api' })) },
      reviewRepo: { findPullByNumber: vi.fn(async () => undefined) },
    });
    const { client, server } = await connectedClient(deps);
    const res = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/payments-api', pr: 999 },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).toContain('#999');
    await client.close();
    await server.close();
  });

  it('a tool with an outputSchema returns BOTH structuredContent and TextContent', async () => {
    const { client, server } = await connectedClient(baseDeps());
    const res = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();
    expect(res.content).toBeDefined();
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(() => JSON.parse(text)).not.toThrow();
    await client.close();
    await server.close();
  });

  // Regression: found by probing a live stdio server with Postgres down. The
  // SDK catches an unanticipated throw and returns `isError: true` with an
  // EMPTY text — a failure carrying no next step, which principle #4 forbids.
  // `guarded()` in server-factory.ts turns it into readable, actionable text.
  it('an unanticipated throw still reaches the model as non-empty, actionable text', async () => {
    const deps = baseDeps();
    // An empty-message Error is exactly what a dead `postgres` connection
    // throws, so this reproduces the original failure rather than a tidy one.
    const boom = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    deps.agentsRepo.list = vi.fn().mockRejectedValue(boom);

    const { client, server } = await connectedClient(deps);
    const res = await client.callTool({ name: 'list_agents', arguments: {} });

    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('ECONNREFUSED');
    expect(text).toContain('pnpm db:migrate');
    await client.close();
    await server.close();
  });
});
