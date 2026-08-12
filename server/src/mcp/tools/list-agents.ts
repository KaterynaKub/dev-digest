/**
 * `list_agents` — MCP protocol wrapper. Schemas, annotations, description,
 * and CallToolResult shaping live HERE; `McpToolsService` knows nothing about
 * MCP (constraint 5).
 */
import { z } from 'zod';
import type { McpToolsService } from '../../modules/mcp-tools/service.js';
import { withStructuredContent, type RegisterableTool } from './types.js';

export function listAgentsTool(service: McpToolsService): RegisterableTool {
  return {
    name: 'list_agents',
    config: {
      description:
        "Lists the review agents configured in DevDigest, with their id, name, provider and model. Takes no arguments. Call this FIRST, before run_agent_on_pr, to get a valid agent id — the other tools accept an agent's id, never its name.",
      inputSchema: {},
      outputSchema: {
        agents: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            provider: z.string(),
            model: z.string(),
            enabled: z.boolean(),
          }),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handler: async () => {
      const agents = await service.listAgents();
      return withStructuredContent({ agents });
    },
  };
}
