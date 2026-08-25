import type { GitClient, RepoRef, Tokenizer } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { RepoRepository } from '../repos/repository.js';
import type {
  ProjectContextRepository,
  ContextDocRow,
  AgentContextDocsView,
} from './repository.js';
import {
  isContainedPath,
  matchRoot,
  buildStatusLine,
  type StatusLine,
} from './helpers.js';
import {
  EXCLUDED_DIRS,
  MAX_DOCS_PER_ENTITY,
  MAX_LISTED_DOCS,
  SUM_ESTIMATE_BUDGET_MS,
  CONTEXT_DOC_EXT,
} from './constants.js';

/**
 * Ports this service needs. Explicit object, never the Container — no import
 * of `Container`, `src/adapters/**`, or `src/db/**` here (`service-no-container`,
 * `service-no-concrete-adapters`). `Tokenizer` is imported ONLY as a type from
 * `@devdigest/shared`; the concrete adapter is resolved in `routes.ts`.
 */
export interface ProjectContextDeps {
  git: GitClient;
  tokenizer: Tokenizer;
  /** Reads the workspace's `context_roots` setting fresh on every call
   *  (AC-45) — resolver, not a value, same shape as `reviews`' `linkAllowlist`. */
  contextRoots: (workspaceId: string) => Promise<string[]>;
  /** Cross-module REPOSITORY read — allowed; only service.ts/routes.ts of
   *  ANOTHER module are not (see `modules/conventions/service.ts`). */
  repoRepo: RepoRepository;
  repo: ProjectContextRepository;
}

export function projectContextDeps(
  container: {
    git: GitClient;
    tokenizer: Tokenizer;
    repoRepo: RepoRepository;
    projectContextRepo: ProjectContextRepository;
  },
  contextRoots: ProjectContextDeps['contextRoots'],
): ProjectContextDeps {
  return {
    git: container.git,
    tokenizer: container.tokenizer,
    contextRoots,
    repoRepo: container.repoRepo,
    repo: container.projectContextRepo,
  };
}

export interface ContextDocument {
  path: string;
  /** Number of agents this path is currently attached to (AC-14). */
  attachedCount: number;
  /** First configured root the path matched — also the type label (AC-64). */
  root: string | null;
}

export interface ContextListing {
  docs: ContextDocument[];
  status: StatusLine;
}

export interface ReadDocumentResult {
  path: string;
  content: string;
  tokens: number;
  approximate: boolean;
  /** True when the working-tree copy differs from committed content (AC-21). */
  dirty: boolean;
}

export interface WriteDocumentResult {
  ok: boolean;
  /** Present only when `ok` is false (AC-23/AC-55). */
  reason?: string;
}

/** An attachment enriched with `missing: true` when it no longer resolves on
 *  disk (AC-37) — the attachment itself is never removed for this. */
export interface AttachmentView extends ContextDocRow {
  missing: boolean;
}

export class ProjectContextService {
  constructor(private deps: ProjectContextDeps) {}

  // ------------------------------------------------------------ discovery --

  /**
   * List every `*.md` document under the workspace's configured context
   * roots, in this repo's clone. The token sum runs in parallel with the
   * listing under `SUM_ESTIMATE_BUDGET_MS`: a slow sum degrades to
   * `pending: true` (AC-61/NFR-21) — it never blocks the listing itself.
   * No clone → `cloned: false`, `count`/`tokenSum` OMITTED, not zero
   * (AC-6/AC-63). `git.listFiles` throwing propagates — an empty list must
   * never be returned as if it were a successful "no docs" result (NFR-7).
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextListing> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const scannedAt = new Date().toISOString();

    if (!repo.clonePath) {
      return {
        docs: [],
        status: buildStatusLine({
          cloned: false,
          count: 0,
          tokenSum: null,
          pending: false,
          fallbackUsed: false,
          truncated: false,
          scannedAt,
        }),
      };
    }

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const roots = await this.deps.contextRoots(workspaceId);

    const { paths, truncated } = await this.deps.git.listFiles(ref, {
      roots,
      ext: CONTEXT_DOC_EXT,
      excludeDirs: [...EXCLUDED_DIRS],
      limit: MAX_LISTED_DOCS,
    });
    const contained = paths.filter((p) => isContainedPath(p));

    const counts = await this.deps.repo.attachmentCountsByPath(workspaceId, repoId);
    const docs: ContextDocument[] = contained.map((path) => ({
      path,
      attachedCount: counts.get(path) ?? 0,
      root: matchRoot(path, roots),
    }));

    const sum = await this.sumTokensWithDeadline(ref, contained);

    return {
      docs,
      status: buildStatusLine({
        cloned: true,
        count: docs.length,
        tokenSum: sum.pending ? null : sum.total,
        pending: sum.pending,
        fallbackUsed: sum.fallbackUsed,
        truncated,
        scannedAt,
      }),
    };
  }

  /**
   * Guard → `git.readFile`. A throw AND an empty-string return are both
   * treated as "missing" (AC-36) — the real client throws on a missing path
   * while `MockGitClient` returns `''`; a caller that only handles one shape
   * passes against the mock and breaks against the real adapter (see root
   * `INSIGHTS.md`).
   */
  async readDocument(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<ReadDocumentResult | null> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!isContainedPath(path)) return null;
    if (!repo.clonePath) return null;

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    let content: string;
    try {
      content = await this.deps.git.readFile(ref, path);
    } catch {
      return null;
    }
    if (!content) return null;

    const dirtyPaths = await this.deps.git.dirtyPaths(ref, [path]);
    return {
      path,
      content,
      tokens: this.deps.tokenizer.count(content),
      approximate: this.deps.tokenizer.approximate,
      dirty: dirtyPaths.includes(path),
    };
  }

  /** `deps.tokenizer.count`, never cached (AC-19) — a figure always reflects
   *  the content passed in at call time. */
  estimateTokens(text: string): { tokens: number; approximate: boolean } {
    return { tokens: this.deps.tokenizer.count(text), approximate: this.deps.tokenizer.approximate };
  }

  // -------------------------------------------------------------- editing --

  /**
   * Write `content` to the working tree, no commit (AC-20). A failure leaves
   * the file as it was and reports why (AC-23/AC-55) — never partial-writes
   * silently. Path + outcome are logged by the CALLER (`routes.ts`, which has
   * `req.log`) — never the text (NFR-11/NFR-17); this method itself does no
   * logging, since a service has no logger port.
   */
  async writeDocument(
    workspaceId: string,
    repoId: string,
    path: string,
    content: string,
  ): Promise<WriteDocumentResult> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!isContainedPath(path)) return { ok: false, reason: 'invalid_path' };
    if (!repo.clonePath) return { ok: false, reason: 'not_cloned' };

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    try {
      await this.deps.git.writeFile(ref, path, content);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'write_failed' };
    }
  }

  /** Repo-relative `*.md` paths under the configured roots whose working tree
   *  differs from committed content (AC-21/AC-22/AC-66). */
  async dirtyDocuments(workspaceId: string, repoId: string): Promise<string[]> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) return [];

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const roots = await this.deps.contextRoots(workspaceId);
    const dirty = await this.deps.git.dirtyPaths(ref, roots);
    return dirty.filter((p) => p.toLowerCase().endsWith(CONTEXT_DOC_EXT));
  }

  // ----------------------------------------------------------- attachment --

  /**
   * `repoId` is OPTIONAL — an attachment stores no `repoId` of its own
   * (AC-10: agents/skills are not tied to one repo), so there is no generic
   * clone to check against unless the caller supplies one. The Project
   * Context page IS repo-scoped (AC-67) and always knows which repo it is
   * viewing, so it passes one; any other caller gets the un-checked list.
   */
  async agentAttachments(
    workspaceId: string,
    agentId: string,
    repoId?: string,
  ): Promise<AttachmentView[]> {
    const rows = await this.deps.repo.listForAgent(workspaceId, agentId);
    return this.markMissing(workspaceId, rows, repoId);
  }

  async skillAttachments(
    workspaceId: string,
    skillId: string,
    repoId?: string,
  ): Promise<AttachmentView[]> {
    const rows = await this.deps.repo.listForSkill(workspaceId, skillId);
    return this.markMissing(workspaceId, rows, repoId);
  }

  /** Validates `MAX_DOCS_PER_ENTITY` and containment BEFORE writing — never
   *  touches `AgentsRepository.update`, so the agent's version is not bumped
   *  (NFR-23). */
  async setAgentDocs(workspaceId: string, agentId: string, paths: string[]): Promise<ContextDocRow[]> {
    this.assertWithinLimit(paths);
    await this.deps.repo.setForAgent(workspaceId, agentId, paths);
    return this.deps.repo.listForAgent(workspaceId, agentId);
  }

  async setSkillDocs(workspaceId: string, skillId: string, paths: string[]): Promise<ContextDocRow[]> {
    this.assertWithinLimit(paths);
    await this.deps.repo.setForSkill(workspaceId, skillId, paths);
    return this.deps.repo.listForSkill(workspaceId, skillId);
  }

  /** Agent's own attachments + inherited attachments from enabled linked
   *  skills, deduped by first position — consumed by `0001b`'s run-time
   *  injection (AC-24…AC-29). Exposed here so that consumer needs no direct
   *  repository access. */
  async agentDocsWithInherited(workspaceId: string, agentId: string): Promise<AgentContextDocsView> {
    return this.deps.repo.listForAgentWithSkills(workspaceId, agentId);
  }

  // ------------------------------------------------------------- internals --

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.repoRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  private assertWithinLimit(paths: string[]): void {
    if (paths.length > MAX_DOCS_PER_ENTITY) {
      throw new ValidationError(`At most ${MAX_DOCS_PER_ENTITY} documents may be attached`);
    }
    for (const path of paths) {
      if (!isContainedPath(path)) {
        throw new ValidationError(`Invalid document path: ${path}`);
      }
    }
  }

  /**
   * "Missing on disk" (AC-37) is only checkable against a specific repo's
   * clone. Without a `repoId` there is nothing to check against, so every
   * attachment reports `missing: false` — never removed either way (AC-37:
   * "mark that attachment as missing … without removing the attachment").
   * With a `repoId`, each path is read from that repo's clone via
   * `git.readFile`; a throw AND an empty-string read both count as missing —
   * same tolerance as `readDocument` (AC-36) — and an unresolvable repo or
   * absent clone degrades the whole batch to `missing: false` rather than
   * failing the attachment list.
   */
  private async markMissing(
    workspaceId: string,
    rows: ContextDocRow[],
    repoId?: string,
  ): Promise<AttachmentView[]> {
    if (!repoId) return rows.map((r) => ({ ...r, missing: false }));

    const repo = await this.deps.repoRepo.getById(workspaceId, repoId);
    if (!repo || !repo.clonePath) return rows.map((r) => ({ ...r, missing: false }));

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    return Promise.all(
      rows.map(async (r) => {
        let content: string;
        try {
          content = await this.deps.git.readFile(ref, r.path);
        } catch {
          return { ...r, missing: true };
        }
        return { ...r, missing: !content };
      }),
    );
  }

  /**
   * Sum `deps.tokenizer.count` over every readable document, racing a
   * `SUM_ESTIMATE_BUDGET_MS` deadline (AC-61/NFR-20/NFR-21). Files unreadable
   * at sum time are skipped (same "missing" tolerance as `readDocument`) —
   * the sum is best-effort and must never fail the listing.
   */
  private async sumTokensWithDeadline(
    ref: RepoRef,
    paths: string[],
  ): Promise<{ total: number; fallbackUsed: boolean; pending: boolean }> {
    let timedOut = false;
    const timer = new Promise<'timeout'>((resolve) => {
      const t = setTimeout(() => {
        timedOut = true;
        resolve('timeout');
      }, SUM_ESTIMATE_BUDGET_MS);
      t.unref?.();
    });

    const work = (async () => {
      let total = 0;
      let fallbackUsed = false;
      for (const path of paths) {
        if (timedOut) break;
        let content: string;
        try {
          content = await this.deps.git.readFile(ref, path);
        } catch {
          continue;
        }
        if (!content) continue;
        total += this.deps.tokenizer.count(content);
        if (this.deps.tokenizer.approximate) fallbackUsed = true;
      }
      return { total, fallbackUsed, pending: false as const };
    })();

    const result = await Promise.race([work, timer]);
    if (result === 'timeout') {
      return { total: 0, fallbackUsed: false, pending: true };
    }
    return result;
  }
}
