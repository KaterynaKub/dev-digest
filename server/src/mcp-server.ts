/**
 * MCP entrypoint (`pnpm mcp`) — stdio transport, no HTTP, no port, no
 * autentication (the channel is the child process's own stdin/stdout).
 * Mirrors `server.ts`: `loadConfig()` → `createDb()` → `new Container(...)`,
 * but never imports `app.ts` (specs/0006-mcp-server.md, "Approach").
 *
 * Composition root (constraint 8): the ONLY module allowed to know
 * `Container`, concrete repositories, `ReviewService`, `ConventionsService`
 * AND the MCP SDK all at once. `McpToolsService` (layer 4) never sees any of
 * these directly — it takes `McpToolsDeps`, built here.
 */
import { loadConfig } from './platform/config.js';
import { createDb } from './db/client.js';
import { Container } from './platform/container.js';
import { buildReviewDeps } from './modules/reviews/routes.js';
import { ReviewService } from './modules/reviews/service.js';
import { ConventionsService, conventionsDeps } from './modules/conventions/service.js';
import { BlastService, blastDeps } from './modules/blast/service.js';
import { McpToolsService, mcpToolsDeps } from './modules/mcp-tools/service.js';
import { createMcpServer } from './mcp/server-factory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main() {
  const config = loadConfig();
  const { db, close } = createDb(config.databaseUrl);
  const container = new Container(config, db);

  const reviewService = new ReviewService(buildReviewDeps(container));
  const conventionsService = new ConventionsService(
    conventionsDeps({
      conventionsRepo: container.conventionsRepo,
      repoRepo: container.repoRepo,
      repoIntel: container.repoIntel,
      git: container.git,
      llm: (provider) => container.llm(provider),
    }),
  );

  // The same service `blastRoutes` builds for `GET /pulls/:id/blast` — the two
  // surfaces share one implementation rather than each assembling the map, so
  // `get_blast_radius` cannot drift from the HTTP route it mirrors (0007 §8).
  const blastService = new BlastService(
    blastDeps({ blastRepo: container.blastRepo, repoIntel: container.repoIntel }),
  );

  const toolsService = new McpToolsService(
    mcpToolsDeps({
      agentsRepo: container.agentsRepo,
      reviewRepo: container.reviewRepo,
      repoRepo: container.repoRepo,
      reviewRunner: reviewService,
      conventionsReader: conventionsService,
      blastReader: blastService,
      // No FastifyRequest exists on this path — LocalNoAuthProvider ignores
      // its argument and always resolves the seeded default workspace
      // (adapters/auth/local.ts), so `undefined` is a valid call here.
      workspaceId: async () => (await container.auth.currentWorkspace(undefined)).id,
    }),
  );

  const server = createMcpServer(toolsService);
  const transport = new StdioServerTransport();

  // Logs ONLY to stderr — stdout is reserved for JSON-RPC frames; a stray
  // console.log would corrupt the protocol stream for every client.
  const log = (msg: string) => process.stderr.write(`${msg}\n`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log(`${signal} received — shutting down`);
    try {
      await server.close();
      await close();
      process.exit(0);
    } catch (err) {
      log(`error during shutdown: ${(err as Error).message}`);
      process.exit(1);
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  await server.connect(transport);
  log('DevDigest MCP server listening on stdio');
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(1);
});
