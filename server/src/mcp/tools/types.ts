/**
 * The shape each `src/mcp/tools/*.ts` factory returns — exactly the 3
 * arguments `McpServer.registerTool(name, config, handler)` takes (SDK
 * 1.30.0, verified empirically in Step 1: `inputSchema`/`outputSchema` are
 * zod-3 RAW SHAPES — `Record<string, ZodType>` — not `z.object({...})` and
 * not hand-rolled JSON Schema). `server-factory.ts` unpacks this 1:1 into
 * `registerTool`.
 */
import type { ZodRawShape } from 'zod';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface RegisterableTool<
  InputArgs extends ZodRawShape = ZodRawShape,
  OutputArgs extends ZodRawShape = ZodRawShape,
> {
  name: string;
  config: {
    description: string;
    inputSchema: InputArgs;
    outputSchema?: OutputArgs;
    annotations: ToolAnnotations;
  };
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * Pair a plain result object with its JSON-text duplicate — every tool that
 * declares an `outputSchema` MUST return both `structuredContent` and
 * `TextContent` (Step 6 "Do (окремо)"): clients without structuredContent
 * support would otherwise see an empty response. The cast to
 * `Record<string, unknown>` is the one place that reconciles this module's
 * concrete DTOs with `CallToolResult.structuredContent`'s index signature.
 */
export function withStructuredContent(result: object): CallToolResult {
  return {
    structuredContent: result as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}
