/**
 * `get_blast_radius` — STUB. Registered so it is discoverable and its
 * `description` (starting with `STUB:`) lets a model deprioritize it before
 * even calling it. Always returns `isError: true` — no implementation yet
 * (Out of scope, specs/0006-mcp-server.md).
 */
import { z } from 'zod';
import { blastRadiusStubText, toolError } from '../errors.js';
import type { RegisterableTool } from './types.js';

export function getBlastRadiusTool(): RegisterableTool {
  return {
    name: 'get_blast_radius',
    config: {
      description:
        "STUB: not yet implemented. Will map how far a PR's changes ripple through the rest of the codebase. For now it always returns an error — use get_findings instead to see the concrete problems in the changed code.",
      inputSchema: { repo: z.string(), pr: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handler: async () => toolError(blastRadiusStubText()),
  };
}
