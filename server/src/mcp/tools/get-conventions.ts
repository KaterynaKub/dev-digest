/**
 * `get_conventions` — MCP protocol wrapper.
 */
import { z } from 'zod';
import {
  RepoFormatError,
  RepoNotFoundError,
  type McpToolsService,
} from '../../modules/mcp-tools/service.js';
import { repoFormatText, repoNotFoundText, toolError } from '../errors.js';
import { withStructuredContent, type RegisterableTool } from './types.js';

export function getConventionsTool(service: McpToolsService): RegisterableTool {
  return {
    name: 'get_conventions',
    config: {
      description:
        'Returns the coding conventions this repository actually follows — naming, error handling, module layout — extracted from its real code, each backed by a path to the file that evidences it. Argument: repo as "owner/name" or a GitHub URL. Read this before writing code in the repository.',
      inputSchema: { repo: z.string() },
      outputSchema: {
        conventions: z.array(
          z.object({ category: z.string(), rule: z.string(), evidence_path: z.string() }),
        ),
        scanned_at: z.string().nullable(),
        total: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handler: async (args) => {
      const { repo } = args as { repo: string };
      try {
        const result = await service.getConventions(repo);
        return withStructuredContent(result);
      } catch (err) {
        if (err instanceof RepoFormatError) return toolError(repoFormatText(err.input));
        if (err instanceof RepoNotFoundError) return toolError(repoNotFoundText(err.repo));
        throw err;
      }
    },
  };
}
