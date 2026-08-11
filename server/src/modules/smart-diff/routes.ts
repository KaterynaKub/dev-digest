import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService, smartDiffDeps } from './service.js';

/**
 * smart-diff module.
 *   GET /pulls/:id/smart-diff → SmartDiff (core/wiring/boilerplate groups + split suggestion)
 *
 * A pure read with no model call and no spend — no rate limit, unlike the
 * money-spending routes elsewhere in this codebase.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService(
    smartDiffDeps({ smartDiffRepo: container.smartDiffRepo }),
  );

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.forPull(workspaceId, req.params.id);
  });
}
