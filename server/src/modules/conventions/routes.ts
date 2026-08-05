import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus, Provider } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import { DEFAULT_CONVENTIONS_MODEL } from './constants.js';
import { resolveScanModel } from './helpers.js';
import { ConventionsService, conventionsDeps } from './service.js';

/**
 * conventions module.
 *   GET   /repos/:id/conventions              → { scan, candidates }
 *   POST  /repos/:id/conventions/extract      → run one scan (201), rate-limited
 *   PATCH /conventions/:id                    → edit text and/or set status
 *   POST  /repos/:id/conventions/bulk         → accept/reject many at once
 *   GET   /repos/:id/conventions/skill-draft  → merged markdown, NOTHING persisted
 *
 * The extract route is the only endpoint here that spends money, hence the
 * tight rate limit (mirrors `POST /skills/import/preview`).
 */

/** Per-scan model choice. Both fields optional; a PARTIAL body is ignored
 *  entirely by `resolveScanModel` rather than merged with the override. */
const ExtractBody = z
  .object({
    provider: Provider.optional(),
    model: z.string().min(1).optional(),
  })
  .optional();

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  status: ConventionStatus.optional(),
});

const BulkBody = z.object({
  status: ConventionStatus,
  ids: z.array(z.string().uuid()).optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(
    conventionsDeps({
      conventionsRepo: container.conventionsRepo,
      repoRepo: container.repoRepo,
      repoIntel: container.repoIntel,
      git: container.git,
      llm: (provider) => container.llm(provider),
    }),
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.view(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams, body: ExtractBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // Priority: per-scan body → workspace override → this module's cheap
      // default. The per-scan choice is deliberately NOT persisted to settings.
      const override = await getFeatureModelOverride(container, workspaceId, 'conventions');
      const model = resolveScanModel(req.body, override, DEFAULT_CONVENTIONS_MODEL);
      const view = await service.extract(workspaceId, req.params.id, model);
      reply.status(201);
      return view;
    },
  );

  app.post(
    '/repos/:id/conventions/bulk',
    { schema: { params: IdParams, body: BulkBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.bulkSetStatus(
        workspaceId,
        req.params.id,
        req.body.status,
        req.body.ids,
      );
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );
}
