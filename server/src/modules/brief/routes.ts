import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBriefRecord, BriefTimelineResponse } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { getFeatureModelOverride, readContextRoots } from '../settings/feature-models.js';
import { DEFAULT_BRIEF_MODEL } from './constants.js';
import { BriefService, briefDeps, type BriefDeps, type StoredBrief, type EmptyBrief } from './service.js';

/**
 * Build the full BriefDeps from the composition root. The three async
 * resolvers (`github`, `llm`, `contextRoots`) are composed HERE — `service.ts`
 * must stay Container-free — matching `reviews/routes.ts#buildReviewDeps`.
 * `blastReader`/`contextDocReader` come from `container.ts` getters, which
 * construct `BlastService`/`ProjectContextService` in the sanctioned
 * composition root: `brief/routes.ts` itself may not import either class
 * directly (`no-cross-module-service`, severity error).
 */
export function buildBriefDeps(container: Container): BriefDeps {
  const base = briefDeps({
    briefRepo: container.briefRepo,
    git: container.git,
    tokenizer: container.tokenizer,
    reviewRepo: container.reviewRepo,
    blastReader: container.blastReader,
    contextDocReader: container.contextDocReader,
  });
  return {
    ...base,
    github: () => container.github(),
    llm: (provider) => container.llm(provider),
    contextRoots: async (workspaceId) => {
      const { roots } = await readContextRoots(container, workspaceId);
      return roots;
    },
  };
}

function toRecord(stored: { pr_id: string; body: StoredBrief['body']; provenance: StoredBrief['provenance'] }): PrBriefRecord {
  return { pr_id: stored.pr_id, ...stored.body, provenance: stored.provenance };
}

/**
 * brief module.
 *   GET  /pulls/:id/brief          → stored brief or null (a pure read, no
 *                                     model call, no rate limit — like
 *                                     `/pulls/:id/blast`)
 *   GET  /pulls/:id/brief/timeline → retained brief history, newest first
 *                                     (0003 — Why Timeline); a pure read, no
 *                                     rate limit, same as the two above. An
 *                                     empty timeline is `{ entries: [] }`,
 *                                     not a 404 — only a missing PR is.
 *   POST /pulls/:id/brief/generate → (re)generate and persist; spends money,
 *                                     so rate-limited like the other
 *                                     money-spending PR routes
 *                                     (`reviews/routes.ts:180`).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(buildBriefDeps(container));

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams } },
    async (req): Promise<(PrBriefRecord & { is_current: boolean }) | null> => {
      const { workspaceId } = await getContext(container, req);
      const stored = await service.getBrief(workspaceId, req.params.id);
      if (!stored) return null;
      return { ...toRecord(stored), is_current: stored.is_current };
    },
  );

  app.get(
    '/pulls/:id/brief/timeline',
    { schema: { params: IdParams } },
    async (req): Promise<BriefTimelineResponse> => {
      const { workspaceId } = await getContext(container, req);
      const entries = await service.getTimeline(workspaceId, req.params.id);
      return { entries };
    },
  );

  app.post(
    '/pulls/:id/brief/generate',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<PrBriefRecord | EmptyBrief> => {
      const { workspaceId } = await getContext(container, req);
      const model =
        (await getFeatureModelOverride(container, workspaceId, 'risk_brief')) ?? DEFAULT_BRIEF_MODEL;
      const result = await service.generate(workspaceId, req.params.id, model);
      reply.code(201);
      if ('empty' in result) return result;
      // `generate` (service.ts) upserts the row before returning; re-reading
      // here is the simplest way for `routes.ts` to attach the provenance the
      // client needs (AC-7/AC-18/AC-27…AC-30) without widening
      // `BriefService.generate`'s return type beyond what step 5 settled on.
      const stored = await service.getBrief(workspaceId, req.params.id);
      if (!stored) throw new Error('brief was generated but could not be read back');
      return toRecord(stored);
    },
  );
}
