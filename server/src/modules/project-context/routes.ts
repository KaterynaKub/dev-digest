import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ContextListing, ContextAttachment } from '@devdigest/shared';
import { SetContextDocsBody } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { readContextRoots } from '../settings/feature-models.js';
import { ProjectContextService, projectContextDeps, type ProjectContextDeps } from './service.js';

/**
 * project-context module.
 *   GET /repos/:id/project-context/docs        → ContextListing (AC-1/AC-67)
 *   GET /repos/:id/project-context/doc?path=   → one document's content + token estimate (AC-4/AC-15/AC-16)
 *   PUT /repos/:id/project-context/doc         → write, no commit (AC-20/AC-55)
 *   GET /repos/:id/project-context/dirty       → preflight for resync/re-index (AC-22/AC-53)
 *   GET|POST /agents/:id/context-docs          → agent attachment set
 *   GET|POST /skills/:id/context-docs          → skill attachment set
 */

/** Build the full ProjectContextDeps from the composition root. `contextRoots`
 *  is composed HERE (not inside service.ts, which must stay Container-free)
 *  — `readContextRoots` is fail-open into the default set (AC-46); a rejected
 *  stored value is logged as a warning per-request (AC-54), same shape as
 *  `reviews/routes.ts`'s `linkAllowlist` resolver. */
export function buildProjectContextDeps(
  container: Container,
  onRejected: (workspaceId: string) => void,
): ProjectContextDeps {
  return projectContextDeps(container, async (workspaceId) => {
    const { roots, rejected } = await readContextRoots(container, workspaceId);
    if (rejected) onRejected(workspaceId);
    return roots;
  });
}

const DocQuery = z.object({ path: z.string().min(1) });
const DocBody = z.object({ path: z.string().min(1), content: z.string() });
/** `repoId` is OPTIONAL — the agent/skill editor is not itself repo-scoped,
 *  but the repo-scoped Project Context page (AC-67) passes it so `missing`
 *  (AC-37) can be checked against that repo's clone instead of always false. */
const AttachmentsQuery = z.object({ repoId: z.string().uuid().optional() });

function toContextDto(listing: Awaited<ReturnType<ProjectContextService['listDocuments']>>): ContextListing {
  return {
    docs: listing.docs.map((d) => ({ path: d.path, attached_count: d.attachedCount, root: d.root })),
    status: {
      count: listing.status.count,
      token_sum: listing.status.tokenSum,
      token_sum_pending: listing.status.pending,
      scanned_at: listing.status.scannedAt,
      truncated: listing.status.truncated,
      fallback_used: listing.status.fallbackUsed,
      cloned: listing.status.cloned,
    },
  };
}

function toAttachmentDtos(rows: { path: string; order: number; missing: boolean }[]): ContextAttachment[] {
  return rows.map((r) => ({ path: r.path, order: r.order, missing: r.missing }));
}

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const deps = buildProjectContextDeps(container, (workspaceId) => {
    app.log.warn({ workspaceId }, 'context_roots setting failed validation — using defaults');
  });
  const service = new ProjectContextService(deps);

  // ---- repo-scoped discovery / read / write --------------------------------

  app.get(
    '/repos/:id/project-context/docs',
    { schema: { params: IdParams } },
    async (req): Promise<ContextListing> => {
      const { workspaceId } = await getContext(container, req);
      const listing = await service.listDocuments(workspaceId, req.params.id);
      return toContextDto(listing);
    },
  );

  app.get(
    '/repos/:id/project-context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const doc = await service.readDocument(workspaceId, req.params.id, req.query.path);
      if (!doc) throw new NotFoundError('Document not found');
      return doc;
    },
  );

  app.put(
    '/repos/:id/project-context/doc',
    { schema: { params: IdParams, body: DocBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.writeDocument(
        workspaceId,
        req.params.id,
        req.body.path,
        req.body.content,
      );
      // Path + outcome only — NEVER `req.body.content` or `result` beyond
      // `ok`/`reason` (NFR-11/NFR-17). `reason` is a short cause string
      // (`invalid_path`, `not_cloned`, or an Error#message), never document text.
      if (result.ok) {
        req.log.info({ repoId: req.params.id, path: req.body.path }, 'project-context doc written');
      } else {
        req.log.warn(
          { repoId: req.params.id, path: req.body.path, reason: result.reason },
          'project-context doc write failed',
        );
        reply.status(422);
      }
      return result;
    },
  );

  app.get(
    '/repos/:id/project-context/dirty',
    { schema: { params: IdParams } },
    async (req): Promise<{ paths: string[] }> => {
      const { workspaceId } = await getContext(container, req);
      const paths = await service.dirtyDocuments(workspaceId, req.params.id);
      return { paths };
    },
  );

  // ---- agent / skill attachment sets ----------------------------------------

  app.get(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, querystring: AttachmentsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const rows = await service.agentAttachments(workspaceId, req.params.id, req.query.repoId);
      return toAttachmentDtos(rows);
    },
  );

  app.post(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const rows = await service.setAgentDocs(workspaceId, req.params.id, req.body.paths);
      return rows.map((r) => ({ path: r.path, order: r.order }));
    },
  );

  app.get(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, querystring: AttachmentsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const rows = await service.skillAttachments(workspaceId, req.params.id, req.query.repoId);
      return toAttachmentDtos(rows);
    },
  );

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: SetContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const rows = await service.setSkillDocs(workspaceId, req.params.id, req.body.paths);
      return rows.map((r) => ({ path: r.path, order: r.order }));
    },
  );
}
