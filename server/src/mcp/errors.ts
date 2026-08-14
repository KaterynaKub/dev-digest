/**
 * Maps this server's typed domain errors (`platform/errors.ts`) — thrown by
 * `McpToolsService` — into an `isError: true` `CallToolResult`. Never a
 * JSON-RPC protocol error: the model must see the failure as tool output it
 * can read and recover from (principle #4, "error leads forward"), not as a
 * transport-level fault.
 *
 * This is the ONLY place in the codebase that spells out the verbatim error
 * texts from `specs/0006-mcp-server.md` Step 6 — never duplicated inline in a
 * tool wrapper or the service. (The 9th, `blastRadiusStubText`, was removed
 * when `get_blast_radius` stopped being a stub — 0007 Step 8.)
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Build an `isError:true` CallToolResult carrying exactly `text`. */
export function toolError(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

// ---- verbatim texts (Step 6 of specs/0006-mcp-server.md — copy exactly) ---

export function agentNotFoundText(id: string): string {
  return `Agent "${id}" was not found. Call list_agents to get the valid agent ids, then retry with one of them.`;
}

export function repoNotFoundText(repo: string): string {
  return `Repository "${repo}" is not connected to DevDigest. Check the "owner/name" spelling, or add the repository in the DevDigest studio at http://localhost:3000.`;
}

export function repoFormatText(input: string): string {
  return `Could not read "${input}" as a repository. Expected "owner/name" or a GitHub URL, for example "acme/payments-api" or "https://github.com/acme/payments-api".`;
}

export function pullNotFoundText(n: number, repo: string): string {
  return `Pull request #${n} was not found in "${repo}". Import it in the DevDigest studio, or check the number — this expects the PR number as shown on GitHub, not an internal id.`;
}

export function noReviewYetText(n: number, repo: string): string {
  return `No review has run yet for pull request #${n} in "${repo}". Call run_agent_on_pr with an agent id from list_agents — it runs the review and returns the findings in one call.`;
}

export function timeoutSingleText(): string {
  return `The review did not finish within 5 minutes and was cancelled; no partial results were saved. Retry, or pick a faster model — list_agents shows the model behind each agent.`;
}

export function timeoutFanOutText(k: number, n: number): string {
  return `${k} of ${n} agents did not finish within 5 minutes, so all runs were cancelled. Call run_agent_on_pr again with a single agent id from list_agents — one agent fits the 5-minute budget.`;
}

export function runFailedText(error: string): string {
  return `The review failed: ${error}. Call list_agents to check the agent's provider and model; if its API key is missing, add it in the DevDigest studio settings.`;
}

/**
 * Last-resort text for a failure no tool anticipated — a dead Postgres, a
 * missing migration, a bug. Without this the SDK catches the throw itself and
 * emits `isError: true` with an EMPTY text, which is the one outcome principle
 * #4 forbids: the model sees a failure carrying no next step. Verified against
 * a live stdio server with Docker stopped — `list_agents` returned
 * `{content:[{type:'text',text:''}],isError:true}` before this existed.
 */
export function unexpectedText(error: string): string {
  return `DevDigest could not serve this request: ${error}. Check that Postgres is running and migrated (cd server && pnpm db:migrate && pnpm db:seed), then retry.`;
}
