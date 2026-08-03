import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import * as yauzl from 'yauzl';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { selectArchiveEntry, type ArchiveEntryMeta } from './helpers.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants.js';
import { SkillsService } from './service.js';

/**
 * skills module.
 *   GET    /skills                       → list (workspace-scoped)
 *   GET    /skills/:id                    → one skill
 *   POST   /skills                        → create (201) — forces enabled:false
 *                                            for any non-'manual' source
 *   PUT    /skills/:id                    → update (body change bumps version)
 *   DELETE /skills/:id                    → delete (cascades agent_skills)
 *   GET    /skills/:id/versions           → body-version history, newest first
 *   GET    /skills/:id/versions/:version  → one body snapshot
 *   POST   /skills/import/preview         → multipart 'file' (.md/.zip) → SkillDraft,
 *                                            NOTHING persisted
 *   GET    /agents/skill-counts           → { agent_id, count }[] (lives here: reads
 *                                            through skillsRepo). Registered BEFORE
 *                                            /agents/:id in the agents module so the
 *                                            static segment wins over the uuid param.
 *
 * `@fastify/multipart` is registered INSIDE this plugin (not globally in
 * app.ts) — module plugins are encapsulated, so overriding `limits.fileSize`
 * here does not touch the global 1MB app.ts body limit used by every other
 * route.
 */

const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // 'PK\x03\x04'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType,
  source: z.enum(['manual', 'imported_url', 'extracted', 'community']),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService({ repo: app.container.skillsRepo });

  // Encapsulated to this plugin only — see module doc comment above.
  await app.register(multipart, {
    limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1 },
  });

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // Static segment — MUST be registered before any dynamic /skills/:id route
  // in this file for correctness of intent (Fastify's router matches the most
  // specific path regardless of registration order, but keeping the literal
  // route textually first documents that "skill-counts" is never a skill id).
  app.get('/agents/skill-counts', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.countsByAgent(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      source: body.source,
      body: body.body,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  // ---- Import preview: stateless parse, NOTHING persisted ------------------
  // Rate-limited: archive extraction is the most CPU-expensive endpoint in
  // this module (mirrors the tight limit on POST /pulls/:id/review).
  app.post(
    '/skills/import/preview',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      await getContext(app.container, req);
      const file = await req.file();
      if (!file) throw new ValidationError('No file uploaded (expected multipart field "file")');

      const buffer = await file.toBuffer();
      const ext = extname(file.filename ?? '');

      if (MARKDOWN_EXTENSIONS.has(ext)) {
        const text = buffer.toString('utf8');
        try {
          return service.previewImport(file.filename ?? 'skill.md', text);
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
      }

      if (ext === '.zip') {
        // Never trust content-type or extension alone — sniff magic bytes too.
        if (buffer.length < 4 || !buffer.subarray(0, 4).equals(MAGIC_ZIP)) {
          throw new ValidationError('Not a valid zip archive');
        }
        const { name, content, sourceEntry } = await extractSkillFromArchive(buffer);
        try {
          const draft = service.previewImport(name, content);
          return { ...draft, source_entry: sourceEntry };
        } catch (err) {
          throw new ValidationError((err as Error).message);
        }
      }

      throw new ValidationError(
        `Unsupported file type "${ext || '(none)'}" — expected .md, .markdown, .txt, or .zip`,
      );
    },
  );
}

export function extname(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

/** Upper 16 bits of externalFileAttributes hold the Unix mode when the entry
 *  was written by a Unix zipper; S_IFLNK = 0xA000 in the mode's file-type bits. */
export function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0xf000;
  return fileType === 0xa000; // S_IFLNK
}

/**
 * Read an archive's central directory ONLY (via lazyEntries + readEntry()) to
 * build the size/name/symlink metadata `selectArchiveEntry` needs — enforcing
 * the entry-count cap and the zip-bomb size cap BEFORE any stream is opened.
 * Only after a `.md` entry is chosen do we open exactly ONE read stream
 * (never for `.sh`/`.js`/other payloads sitting in the same archive — the
 * concrete answer to "executable parts are never processed").
 */
export async function extractSkillFromArchive(
  buffer: Buffer,
): Promise<{ name: string; content: string; sourceEntry: string }> {
  const zipfile = await openZip(buffer);
  try {
    const entries: yauzl.Entry[] = [];
    let totalUncompressed = 0;

    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: yauzl.Entry) => {
        entries.push(entry);
        totalUncompressed += entry.uncompressedSize;
        if (entries.length > MAX_ARCHIVE_ENTRIES) {
          reject(new ValidationError(`Archive has too many entries (max ${MAX_ARCHIVE_ENTRIES})`));
          return;
        }
        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
          reject(
            new ValidationError(
              `Archive's uncompressed size exceeds the limit (max ${MAX_UNCOMPRESSED_BYTES} bytes)`,
            ),
          );
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve());
      zipfile.on('error', (err: Error) => reject(err));
      zipfile.readEntry();
    });

    const meta: ArchiveEntryMeta[] = entries.map((e) => ({
      fileName: e.fileName,
      uncompressedSize: e.uncompressedSize,
      isSymlink: isSymlinkEntry(e),
    }));
    const selected = selectArchiveEntry(meta);
    if (!selected) throw new ValidationError('No markdown (.md) file found in the archive');

    const entry = entries.find((e) => e.fileName === selected.fileName)!;
    const content = await readEntryText(zipfile, entry);
    return { name: selected.fileName, content, sourceEntry: selected.fileName };
  } finally {
    zipfile.close();
  }
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // lazyEntries: we drive readEntry() ourselves so the central directory is
    // fully enumerated (sizes summed) before any openReadStream call.
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) reject(err ?? new Error('Failed to open archive'));
      else resolve(zipfile);
    });
  });
}

/** Open exactly one read stream — for the ALREADY-SELECTED `.md` entry only. */
function readEntryText(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('Failed to read archive entry'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      stream.on('data', (chunk: Buffer) => {
        bytesRead += chunk.length;
        // Defend against a lying local-file-header size (declared size can
        // differ from what actually decompresses) by capping mid-stream too.
        if (bytesRead > MAX_UNCOMPRESSED_BYTES) {
          stream.destroy();
          reject(new ValidationError('Archive entry exceeded its declared size'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}
