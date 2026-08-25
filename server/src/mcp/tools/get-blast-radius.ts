/**
 * `get_blast_radius` — MCP protocol wrapper over the SAME service path
 * `GET /pulls/:id/blast` serves (`BlastService.forPull`, reached through the
 * `BlastReader` port). Step 8 of `specs/0007-blast-radius.md`; this file
 * replaced the registered STUB.
 *
 * The `outputSchema` mirrors the `BlastRadius` contract field-for-field,
 * INCLUDING `index_status`/`degraded`/`reason`. Those three are not metadata to
 * be trimmed for brevity: an empty `downstream` on a full index ("nothing calls
 * this") and an empty `downstream` on a missing index ("we do not know what
 * calls this") are opposite answers, and a model that receives only the empty
 * array cannot tell them apart. Dropping them here would resurrect exactly the
 * failure §4.2 was written to prevent, on the one surface where the consumer is
 * a model rather than a card with a degraded banner.
 */
import { z } from 'zod';
import {
  PullNotFoundError,
  RepoFormatError,
  RepoNotFoundError,
  type McpToolsService,
} from '../../modules/mcp-tools/service.js';
import { pullNotFoundText, repoFormatText, repoNotFoundText, toolError } from '../errors.js';
import { withStructuredContent, type RegisterableTool } from './types.js';

const outputSchema = {
  changed_symbols: z.array(z.object({ name: z.string(), file: z.string(), kind: z.string() })),
  downstream: z.array(
    z.object({
      symbol: z.string(),
      callers: z.array(z.object({ name: z.string(), file: z.string(), line: z.number() })),
      endpoints_affected: z.array(z.string()),
      crons_affected: z.array(z.string()),
    }),
  ),
  summary: z.string(),
  /** Never optional — see the module comment on why this must reach the model. */
  index_status: z.enum(['full', 'partial', 'degraded', 'failed']),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  /** The commit every `file`/`line` above is a coordinate in. */
  indexed_sha: z.string().nullable(),
  /** true when that commit is older than the PR's head — see the contract. */
  index_stale: z.boolean(),
};

export function getBlastRadiusTool(service: McpToolsService): RegisterableTool {
  return {
    name: 'get_blast_radius',
    config: {
      description:
        'Maps which symbols a pull request changed and what else in the codebase depends on them: the callers of each changed symbol (with file and line), plus the HTTP endpoints and cron jobs those callers sit behind. Reads the existing code index — it starts no review and spends nothing. Arguments: repo as "owner/name" or a GitHub URL, pr as the PR number. Always check index_status: on "partial", "degraded" or "failed" the downstream list is INCOMPLETE and an empty result means "unknown", not "nothing is affected" — only index_status "full" makes an empty downstream a real finding of no impact. Every file/line is a coordinate in the commit named by indexed_sha, NOT in the PR head; when index_stale is true that commit is older than the PR, so line numbers will not match the current file and the counts may miss callers added since.',
      inputSchema: { repo: z.string(), pr: z.number() },
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handler: async (args) => {
      const { repo, pr } = args as { repo: string; pr: number };
      try {
        const result = await service.getBlastRadius(repo, pr);
        // `reason` is `.nullish()` in the contract but declared `.nullable()`
        // above: the SDK validates the handler's own output, and an ABSENT
        // key would fail that check while an explicit null passes. Normalising
        // here keeps the tool's payload shape fixed regardless of which branch
        // in `buildBlastRadius` produced it.
        return withStructuredContent({ ...result, reason: result.reason ?? null });
      } catch (err) {
        if (err instanceof RepoFormatError) return toolError(repoFormatText(err.input));
        if (err instanceof RepoNotFoundError) return toolError(repoNotFoundText(err.repo));
        if (err instanceof PullNotFoundError) return toolError(pullNotFoundText(err.number, err.repo));
        throw err;
      }
    },
  };
}
