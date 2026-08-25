import type { FastifyRequest } from 'fastify';
import type { Container } from '../../platform/container.js';

export interface RequestContext {
  workspaceId: string;
  userId: string;
  /**
   * Correlates every log line and downstream call made while serving one
   * request. Falls back to the inbound `x-request-id` header, then to the
   * Fastify-assigned `req.id`, so it is ALWAYS populated.
   */
  requestId: string;
}

/** Options for {@link getContext}. All fields optional — callers opt in. */
export interface GetContextOptions {
  /**
   * Skip the workspace lookup and trust this id. Only for callers that have
   * already resolved (and authorised) the workspace on this request.
   */
  workspaceIdHint?: string;
}

/**
 * Resolve the tenancy context for a request via the AuthProvider. In MVP
 * (LocalNoAuthProvider) this always returns the default workspace + system user.
 * Every module uses this so workspace scoping is never forgotten.
 *
 * The third parameter is OPTIONAL and backwards-compatible: every existing
 * two-argument call site keeps working unchanged.
 */
export async function getContext(
  container: Container,
  req: FastifyRequest,
  opts: GetContextOptions = {},
): Promise<RequestContext> {
  const requestId = resolveRequestId(req);

  if (opts.workspaceIdHint) {
    const user = await container.auth.currentUser(req);
    return { workspaceId: opts.workspaceIdHint, userId: user.id, requestId };
  }

  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ]);
  return { workspaceId: workspace.id, userId: user.id, requestId };
}

/** Inbound correlation id, or Fastify's own request id as the fallback. */
function resolveRequestId(req: FastifyRequest): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  if (Array.isArray(header) && header[0]) return header[0];
  return String(req.id);
}
