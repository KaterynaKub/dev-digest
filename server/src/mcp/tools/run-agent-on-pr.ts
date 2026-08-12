/**
 * `run_agent_on_pr` — MCP protocol wrapper. See `types.ts` for the shared
 * `RegisterableTool` shape and `list-agents.ts` for the layering note.
 */
import { z } from 'zod';
import {
  AgentNotFoundError,
  PullNotFoundError,
  RepoFormatError,
  RepoNotFoundError,
  type McpToolsService,
} from '../../modules/mcp-tools/service.js';
import {
  agentNotFoundText,
  pullNotFoundText,
  repoFormatText,
  repoNotFoundText,
  runFailedText,
  timeoutFanOutText,
  timeoutSingleText,
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

export function runAgentOnPrTool(service: McpToolsService): RegisterableTool {
  return {
    name: 'run_agent_on_pr',
    config: {
      description:
        'Reviews a pull request and WAITS for the run to finish (up to 5 minutes), then returns the finished verdict with the findings. Arguments: repo as "owner/name" or a GitHub URL, pr as the PR number, agent as an id from list_agents — omit agent to run every enabled agent. This is the only tool that spends money.',
      inputSchema: { repo: z.string(), pr: z.number(), agent: z.string().optional() },
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    handler: async (args) => {
      const { repo, pr, agent } = args as { repo: string; pr: number; agent?: string };
      try {
        const result = await service.runAgentOnPr(repo, pr, agent);
        if (result.run_status === 'timed_out') {
          // The timeout text distinguishes a single-agent run (retry / pick a
          // faster model) from a fan-out (retry with ONE agent id) — Step 6.
          const total = result.agents.length;
          const finished = result.agents.filter((a) => a.status === 'done').length;
          const notFinished = total - finished;
          return toolError(
            total <= 1 ? timeoutSingleText() : timeoutFanOutText(notFinished, total),
          );
        }
        return withStructuredContent(result);
      } catch (err) {
        if (err instanceof AgentNotFoundError) return toolError(agentNotFoundText(err.agentId));
        if (err instanceof RepoFormatError) return toolError(repoFormatText(err.input));
        if (err instanceof RepoNotFoundError) return toolError(repoNotFoundText(err.repo));
        if (err instanceof PullNotFoundError) return toolError(pullNotFoundText(err.number, err.repo));
        return toolError(runFailedText((err as Error).message));
      }
    },
  };
}
