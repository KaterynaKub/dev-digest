/**
 * `get_findings` — MCP protocol wrapper. Same `outputSchema` shape as
 * `run_agent_on_pr` (Step 6 of the spec).
 */
import { z } from 'zod';
import {
  NoReviewYetError,
  PullNotFoundError,
  RepoFormatError,
  RepoNotFoundError,
  type McpToolsService,
} from '../../modules/mcp-tools/service.js';
import {
  noReviewYetText,
  pullNotFoundText,
  repoFormatText,
  repoNotFoundText,
  toolError,
} from '../errors.js';
import { withStructuredContent, type RegisterableTool } from './types.js';

const outputSchema = {
  verdict: z.enum(['blocked', 'concerns', 'clean']),
  findings: z.array(
    z.object({
      severity: z.string(),
      category: z.string(),
      title: z.string(),
      file: z.string(),
      lines: z.string(),
      rationale: z.string(),
    }),
  ),
  agents: z.array(z.object({ agent_id: z.string(), agent_name: z.string(), status: z.string() })),
  run_status: z.enum(['completed', 'timed_out']),
  shown: z.number(),
  total: z.number(),
  note: z.string().optional(),
};

export function getFindingsTool(service: McpToolsService): RegisterableTool {
  return {
    name: 'get_findings',
    config: {
      description:
        'Returns the verdict and findings of a review that ALREADY ran — it starts nothing and spends nothing. Arguments: repo as "owner/name" or a GitHub URL, pr as the PR number, response_format CONCISE (default) or DETAILED. Prefer this over run_agent_on_pr whenever the PR has been reviewed before.',
      inputSchema: {
        repo: z.string(),
        pr: z.number(),
        response_format: z.enum(['CONCISE', 'DETAILED']).optional(),
      },
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handler: async (args) => {
      const { repo, pr, response_format } = args as {
        repo: string;
        pr: number;
        response_format?: 'CONCISE' | 'DETAILED';
      };
      try {
        const result = await service.getFindings(repo, pr, response_format ?? 'CONCISE');
        return withStructuredContent(result);
      } catch (err) {
        if (err instanceof RepoFormatError) return toolError(repoFormatText(err.input));
        if (err instanceof RepoNotFoundError) return toolError(repoNotFoundText(err.repo));
        if (err instanceof PullNotFoundError) return toolError(pullNotFoundText(err.number, err.repo));
        if (err instanceof NoReviewYetError) return toolError(noReviewYetText(err.number, err.repo));
        throw err;
      }
    },
  };
}
