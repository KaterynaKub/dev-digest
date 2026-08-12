/**
 * `createMcpServer` — builds the `McpServer` and registers the 5 tools in
 * `TOOL_NAMES` order (constraint 6: a fixed literal array, not
 * `Object.values()`, so `tools/list` is stable across restarts). This module
 * (`src/mcp/**`) is layer 5 — the only place the MCP SDK is imported.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_NAMES } from '../modules/mcp-tools/constants.js';
import type { McpToolsService } from '../modules/mcp-tools/service.js';
import { listAgentsTool } from './tools/list-agents.js';
import { runAgentOnPrTool } from './tools/run-agent-on-pr.js';
import { getFindingsTool } from './tools/get-findings.js';
import { getConventionsTool } from './tools/get-conventions.js';
import { getBlastRadiusTool } from './tools/get-blast-radius.js';
import type { RegisterableTool } from './tools/types.js';
import { toolError, unexpectedText } from './errors.js';

export function createMcpServer(service: McpToolsService): McpServer {
  const server = new McpServer({ name: 'devdigest', version: '0.0.0' });

  const byName: Record<(typeof TOOL_NAMES)[number], RegisterableTool> = {
    list_agents: listAgentsTool(service),
    run_agent_on_pr: runAgentOnPrTool(service),
    get_findings: getFindingsTool(service),
    get_conventions: getConventionsTool(service),
    get_blast_radius: getBlastRadiusTool(),
  };

  // Fixed order — see the module doc comment above.
  for (const name of TOOL_NAMES) {
    const tool = byName[name];
    server.registerTool(tool.name, tool.config, guarded(tool.handler));
  }

  return server;
}

/**
 * Wrap a tool handler so an UNANTICIPATED throw still reaches the model as
 * readable text. Each wrapper already maps its own typed errors; this catches
 * everything else (dead Postgres, unmigrated schema, a bug). Without it the SDK
 * catches the throw and returns `isError: true` with an empty text — a failure
 * with no next step, which principle #4 forbids. The throw is also mirrored to
 * stderr, since stdout carries the JSON-RPC frames.
 */
/** Best available one-line description of a thrown value, never empty. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message) return err.message;
    // `postgres` connection failures surface as an Error with an empty
    // message; `code` (e.g. ECONNREFUSED) and the class name still identify it.
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return `${err.name}: ${code}`;
    return err.name || 'unknown error';
  }
  const s = String(err);
  return s && s !== '[object Object]' ? s : 'unknown error';
}

function guarded(handler: RegisterableTool['handler']): RegisterableTool['handler'] {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      // A failed `postgres` connection throws an Error whose `message` is an
      // empty string, so fall back to the error's name/constructor — verified
      // live with Docker stopped. Never interpolate an empty string here: the
      // text is the model's only clue about what went wrong.
      const message = describeError(err);
      console.error('[mcp] unhandled tool error:', err);
      return toolError(unexpectedText(message));
    }
  };
}
