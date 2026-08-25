import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService, blastDeps } from './service.js';

/**
 * blast module.
 *   GET /pulls/:id/blast → BlastRadius (changed symbols, downstream callers,
 *   affected endpoints/crons, explicit index state)
 *
 * A pure read of the repo-intel index with no model call and no spend — no
 * rate limit, exactly like `/pulls/:id/smart-diff`.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(
    blastDeps({ blastRepo: container.blastRepo, repoIntel: container.repoIntel }),
  );

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.forPull(workspaceId, req.params.id);
  });
}
