import type {
  ConventionExtraction,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsView,
  FeatureModelChoice,
  GitClient,
  LLMProvider,
  Provider,
  RepoRef,
} from '@devdigest/shared';
import { ConventionExtractionResult } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { renderPrompt } from '../../platform/prompts.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { RepoIntel } from '../repo-intel/types.js';
import type { ConventionsRepository } from './repository.js';
import type { RepoRepository } from '../repos/repository.js';
import {
  CONFIG_PROBE_PATHS,
  MAX_CANDIDATES,
  MAX_CONFIG_CHARS,
  MAX_FILE_CHARS,
  MAX_TOTAL_CHARS,
  MIN_CONFIDENCE,
  SAMPLE_FILE_COUNT,
} from './constants.js';
import {
  buildSkillDraft,
  numberLines,
  toCandidateDto,
  toScanDto,
  verifyCandidates,
  type SampledFile,
} from './helpers.js';

/**
 * Conventions service — the extraction pipeline.
 *
 * Sample selection is entirely CODE-DRIVEN: config files are probed by exact
 * path and source files come from repo-intel's rank. Exactly ONE model call is
 * made per scan, and everything it returns passes through a mechanical
 * evidence gate before it can be persisted.
 */

/** Ports this service needs. Explicit object, never the Container. */
export interface ConventionsDeps {
  repo: ConventionsRepository;
  /** Cross-module REPOSITORY read — allowed; only service.ts/routes.ts are not. */
  repoRepo: RepoRepository;
  repoIntel: RepoIntel;
  git: GitClient;
  /** Lazily resolved so a missing provider key fails THIS request only. */
  llm: (provider: Provider) => Promise<LLMProvider>;
}

export class ConventionsService {
  constructor(private deps: ConventionsDeps) {}

  /** Everything the Conventions page needs in one response. */
  async view(workspaceId: string, repoId: string): Promise<ConventionsView> {
    await this.requireRepo(workspaceId, repoId);
    const [scan, rows] = await Promise.all([
      this.deps.repo.getLatestScan(workspaceId, repoId),
      this.deps.repo.listByRepo(workspaceId, repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
    };
  }

  /**
   * Run one extraction. Synchronous: a cheap model over ~12 truncated files
   * takes seconds, and the UI shows an inline "Scanning…" state rather than a
   * progress stream.
   */
  async extract(
    workspaceId: string,
    repoId: string,
    model: FeatureModelChoice,
  ): Promise<ConventionsView> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ValidationError('Repository has not finished cloning yet');
    }
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const configs = await this.readConfigFiles(ref);
    const sources = await this.readSourceSamples(ref, repoId);
    const files = this.applyBudget(configs, sources);

    // Nothing to look at — record the scan so the UI can say so, and do NOT
    // spend a model call.
    if (files.length === 0) {
      await this.deps.repo.recordScan({
        workspaceId,
        repoId,
        sampleCount: 0,
        configCount: 0,
        candidatesRaw: 0,
        model: model.model,
        candidates: [],
      });
      return this.view(workspaceId, repoId);
    }

    const configCount = files.filter((f) =>
      (CONFIG_PROBE_PATHS as readonly string[]).includes(f.path),
    ).length;

    const raw = await this.callModel(model, files);
    const { kept } = verifyCandidates(raw, files);

    const candidates = kept
      .filter((c) => c.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES);

    await this.deps.repo.recordScan({
      workspaceId,
      repoId,
      sampleCount: files.length,
      configCount,
      candidatesRaw: raw.length,
      model: model.model,
      candidates,
    });

    return this.view(workspaceId, repoId);
  }

  /** Patch one candidate (edit its text and/or flip its status). */
  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; category?: string; status?: ConventionStatus },
  ) {
    const row = await this.deps.repo.updateOne(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toCandidateDto(row);
  }

  /** Bulk accept/reject. Without `ids`, targets every pending candidate. */
  async bulkSetStatus(
    workspaceId: string,
    repoId: string,
    status: ConventionStatus,
    ids?: string[],
  ): Promise<{ updated: number }> {
    await this.requireRepo(workspaceId, repoId);
    const updated = await this.deps.repo.bulkSetStatus(workspaceId, repoId, status, ids);
    return { updated };
  }

  /**
   * The merged markdown for the accepted candidates. A pure READ — nothing is
   * persisted until the client confirms via `POST /skills`.
   */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const rows = await this.deps.repo.listAcceptedByRepo(workspaceId, repoId);
    return buildSkillDraft(repo.fullName, repo.name, rows);
  }

  // ------------------------------------------------------------- internals

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.repoRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return repo;
  }

  /**
   * Config files, by exact-path probe. They cannot come from repo-intel:
   * `walkClone` never indexes `.json`, and `getConventionSamples` filters
   * eslint/prettier/`.config.` out via `JUNK_PATH_PATTERNS`.
   */
  private async readConfigFiles(ref: RepoRef): Promise<SampledFile[]> {
    const out: SampledFile[] = [];
    for (const path of CONFIG_PROBE_PATHS) {
      const content = await this.readFileSafe(ref, path, MAX_CONFIG_CHARS);
      if (content) out.push({ path, content });
    }
    return out;
  }

  /** Top-ranked source files. Degrades to [] on an unindexed repo. */
  private async readSourceSamples(ref: RepoRef, repoId: string): Promise<SampledFile[]> {
    const paths = await this.deps.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    const out: SampledFile[] = [];
    for (const path of paths) {
      const content = await this.readFileSafe(ref, path, MAX_FILE_CHARS);
      if (content) out.push({ path, content });
    }
    return out;
  }

  /**
   * Read one repo file, truncated to `limit`, returning '' on any failure.
   * The real `GitClient.readFile` THROWS on a missing file while the mock
   * returns '' — both must degrade to "skip this file", never bubble.
   */
  private async readFileSafe(ref: RepoRef, path: string, limit: number): Promise<string> {
    let raw: string;
    try {
      raw = await this.deps.git.readFile(ref, path);
    } catch {
      return '';
    }
    if (!raw || raw.trim().length === 0) return '';
    return raw.length > limit ? `${raw.slice(0, limit)}\n… [truncated]` : raw;
  }

  /** Configs first (highest signal per token), then sources, up to the cap. */
  private applyBudget(configs: SampledFile[], sources: SampledFile[]): SampledFile[] {
    const out: SampledFile[] = [];
    let total = 0;
    for (const file of [...configs, ...sources]) {
      if (total + file.content.length > MAX_TOTAL_CHARS) continue;
      out.push(file);
      total += file.content.length;
    }
    return out;
  }

  /**
   * The single structured call. Zod → JSON-schema conversion and the
   * parse/repair retry loop come free from the provider adapter.
   */
  private async callModel(
    model: FeatureModelChoice,
    files: SampledFile[],
  ): Promise<ConventionExtraction[]> {
    const llm = await this.deps.llm(model.provider);
    const system = await renderPrompt('conventions.system.md', {
      max_candidates: String(MAX_CANDIDATES),
      min_confidence: String(MIN_CONFIDENCE),
    });

    const blocks = files.map((f) => {
      const numbered = numberLines(f.content);
      const lines = numbered.split('\n').length;
      // The `### FILE:` header is TRUSTED text we emit; only the body is
      // wrapped as untrusted data.
      return `### FILE: ${f.path} (lines 1-${lines})\n${wrapUntrusted(f.path, numbered)}`;
    });

    const res = await llm.completeStructured({
      model: model.model,
      schema: ConventionExtractionResult,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Extract the conventions this codebase follows.\n\n${blocks.join('\n\n')}`,
        },
      ],
      maxRetries: 2,
    });

    return res.data.candidates;
  }
}

/** Build the service's ports from the container (mirrors `reviewDeps`). */
export function conventionsDeps(container: {
  conventionsRepo: ConventionsRepository;
  repoRepo: RepoRepository;
  repoIntel: RepoIntel;
  git: GitClient;
  llm: (provider: Provider) => Promise<LLMProvider>;
}): ConventionsDeps {
  return {
    repo: container.conventionsRepo,
    repoRepo: container.repoRepo,
    repoIntel: container.repoIntel,
    git: container.git,
    llm: container.llm,
  };
}
