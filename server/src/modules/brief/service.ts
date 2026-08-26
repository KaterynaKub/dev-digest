/**
 * BriefService — assembly, generation, and cache (application service, layer
 * 4). Ports arrive as an explicit `BriefDeps` object; this file never imports
 * `Container`, `src/db/**`, `drizzle-orm`, `fastify`, or `src/adapters/**`
 * with real I/O, and never imports another module's `service.ts`/`routes.ts`
 * (`no-cross-module-service`, severity error). The two cross-module
 * dependencies — blast and Project Context — are consumed as structural
 * ports declared here and satisfied in `routes.ts`/`platform/container.ts`.
 */
import type {
  BlastRadius,
  BriefProvenance,
  BriefTimelineEntry,
  FeatureModelChoice,
  GitClient,
  GitHubClient,
  LLMProvider,
  PrBrief,
  Provider,
  Tokenizer,
} from '@devdigest/shared';
import { PrBrief as PrBriefSchema } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { AppError, ConflictError, NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import { isContainedPath } from '../project-context/helpers.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { parseIssueRefs } from '../reviews/intent-inputs.js';
import type { ReviewRepository } from '../reviews/repository.js';
import {
  applyDocLimits,
  buildBriefLineIndex,
  enforceInputBudget,
  rankDocuments,
  renderBriefFileList,
  validateReferences,
  type BriefSection,
} from './helpers.js';
import {
  DOC_SELECT_BUDGET_MS,
  MAX_BRIEF_BODY_CHARS,
  MAX_BRIEF_FOCUS,
  MAX_BRIEF_HISTORY,
  MAX_BRIEF_INPUT_TOKENS,
  MAX_BRIEF_ISSUE_CHARS,
  MAX_BRIEF_RISKS,
} from './constants.js';
import type { BriefRepository } from './repository.js';

/**
 * Structural port over `BlastService.forPull` — never an import of that
 * class (`no-cross-module-service`). Same pattern as `mcp-tools`'
 * `BlastReader` (`server/src/modules/mcp-tools/service.ts`). Typed against
 * the shared `BlastRadius` contract, not a locally re-declared shape.
 */
export interface BlastReader {
  forPull(workspaceId: string, prId: string): Promise<BlastRadius>;
}

/** Structural port over `ProjectContextService`'s discovery + read. */
export interface ContextDocReader {
  listDocuments(workspaceId: string, repoId: string): Promise<{ docs: { path: string }[] }>;
  readDocument(workspaceId: string, repoId: string, path: string): Promise<{ content: string } | null>;
}

export interface BriefDeps {
  repo: BriefRepository;
  git: GitClient;
  tokenizer: Tokenizer;
  /** Resolver: a missing GitHub token must fail one generation, not app startup. */
  github: () => Promise<GitHubClient>;
  /** Resolver, matching the existing `llm: (provider) => …` convention. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** Reads the workspace's `context_roots` setting fresh on every call. */
  contextRoots: (workspaceId: string) => Promise<string[]>;
  /** For `loadDiff` — a cross-module REPOSITORY read, which is allowed
   *  (`conventions/service.ts` imports `RepoRepository` the same way). */
  reviewRepo: ReviewRepository;
  blastReader: BlastReader;
  contextDocReader: ContextDocReader;
}

export function briefDeps(container: {
  briefRepo: BriefRepository;
  git: GitClient;
  tokenizer: Tokenizer;
  reviewRepo: ReviewRepository;
  blastReader: BlastReader;
  contextDocReader: ContextDocReader;
}): BriefDeps {
  return {
    repo: container.briefRepo,
    git: container.git,
    tokenizer: container.tokenizer,
    github: () => {
      throw new Error('github resolver must be overridden by routes.ts');
    },
    llm: () => {
      throw new Error('llm resolver must be overridden by routes.ts');
    },
    contextRoots: () => {
      throw new Error('contextRoots resolver must be overridden by routes.ts');
    },
    reviewRepo: container.reviewRepo,
    blastReader: container.blastReader,
    contextDocReader: container.contextDocReader,
  };
}

export interface StoredBrief {
  pr_id: string;
  body: PrBrief;
  provenance: BriefProvenance;
  /** true when this row matches the PR's current head sha AND the blast
   *  radius's current indexed_sha (AC-27…AC-30). */
  is_current: boolean;
}

/** The "PR changed nothing" state (AC-39) — no model call, ever. */
export interface EmptyBrief {
  empty: true;
}

// In-flight generation guard (AC-58): a module-level set, not per-instance —
// mirrors the discipline that a second concurrent request for the SAME PR
// must be rejected regardless of which request object served the first.
const inFlight = new Set<string>();

export class BriefService {
  constructor(private deps: BriefDeps) {}

  /**
   * Read-only. Never a model call (AC-29, AC-30, NFR-1). `is_current` is
   * `===` on `null` on both sides, which is exactly what makes AC-28's
   * distinct "no index" key value work: a brief built with `indexed_sha: null`
   * matches only a PR whose blast radius ALSO currently reports `null`.
   */
  async getBrief(workspaceId: string, prId: string): Promise<StoredBrief | null> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const stored = await this.deps.repo.getBrief(prId);
    if (!stored) return null;

    let currentIndexedSha: string | null = null;
    try {
      const blast = await this.deps.blastReader.forPull(workspaceId, prId);
      currentIndexedSha = blast.indexed_sha;
    } catch {
      // Blast unavailable: cannot confirm currency against the index leg of
      // the key, so the stored brief is treated as not current (AC-30) rather
      // than thrown — a read must never fail because blast is down.
      return { pr_id: stored.prId, body: stored.body, provenance: stored.provenance, is_current: false };
    }

    const isCurrent =
      stored.provenance.head_sha === pull.headSha && stored.provenance.indexed_sha === currentIndexedSha;
    return { pr_id: stored.prId, body: stored.body, provenance: stored.provenance, is_current: isCurrent };
  }

  /**
   * Read-only history for this PR (Why Timeline, 0003), newest first, at most
   * `MAX_BRIEF_HISTORY` entries. Never a model call. The workspace scope gate
   * (`getPull`) is the only check `pr_brief` gets, same as `getBrief` — the
   * table carries no `workspace_id` of its own.
   */
  async getTimeline(workspaceId: string, prId: string): Promise<BriefTimelineEntry[]> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const rows = await this.deps.repo.listBriefs(prId, MAX_BRIEF_HISTORY);

    let currentIndexedSha: string | null = null;
    let currencyKnown = true;
    try {
      const blast = await this.deps.blastReader.forPull(workspaceId, prId);
      currentIndexedSha = blast.indexed_sha;
    } catch {
      // Blast unavailable: currency is unknowable for EVERY entry — the same
      // rule `getBrief` applies above, so the two reads never disagree.
      currencyKnown = false;
    }

    return rows.map((row) => ({
      head_sha: row.head_sha,
      indexed_sha: row.indexed_sha,
      generated_at: row.generated_at,
      risk_level: row.risk_level,
      what: row.what,
      // `===` on `null` both sides is what makes AC-28's distinct value work —
      // never `==`, never coerced through `indexed_sha_key`.
      is_current: currencyKnown && row.head_sha === pull.headSha && row.indexed_sha === currentIndexedSha,
    }));
  }

  /**
   * Produce a brief and replace any stored one (AC-31). Guards against
   * concurrent generation for the same PR (AC-58) and a mid-flight head-sha
   * change (AC-33) by capturing the head sha BEFORE the model call and
   * persisting against that captured value, never a re-read.
   */
  async generate(workspaceId: string, prId: string, model: FeatureModelChoice): Promise<PrBrief | EmptyBrief> {
    if (inFlight.has(prId)) {
      throw new ConflictError('A brief is already being generated for this pull request');
    }
    inFlight.add(prId);
    try {
      return await this.doGenerate(workspaceId, prId, model);
    } finally {
      inFlight.delete(prId);
    }
  }

  private async doGenerate(
    workspaceId: string,
    prId: string,
    model: FeatureModelChoice,
  ): Promise<PrBrief | EmptyBrief> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.deps.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    // `loadDiff` is typed against `reviews/repository.ts#RepoRow` (the full
    // Drizzle row); fetched separately from the SAME repo id so `loadDiff`
    // needs no cast, while `repoRow` above stays this module's own
    // domain-shaped row for everything else (Project Context, GitHub).
    const reviewRepoRow = await this.deps.reviewRepo.getRepo(pull.repoId);
    if (!reviewRepoRow) throw new NotFoundError('Repository not found');

    // Head sha captured NOW — this is what the brief is stored against
    // (AC-33), regardless of whether the PR is pushed again mid-flight.
    const headSha = pull.headSha;

    const diff = await loadDiff(this.deps.git, this.deps.reviewRepo, workspaceId, pull, reviewRepoRow);

    // AC-39: a PR that changed nothing is a fact, not a data gap — no model
    // call at all, mirroring `BlastService.forPull`'s early return.
    if (diff.files.length === 0) {
      return { empty: true };
    }

    const missingInputs: string[] = [];

    // Intent, blast, and the linked issue are each independent and each
    // degrades to a missing_inputs entry rather than a throw (AC-35, AC-36,
    // AC-38, NFR-9).
    const issueRefs = parseIssueRefs(pull.body ?? '');
    const firstIssueRef = issueRefs[0];
    const [intentOutcome, blastOutcome, issueOutcome] = await Promise.allSettled([
      this.deps.repo.getIntent(prId),
      this.deps.blastReader.forPull(workspaceId, prId),
      firstIssueRef !== undefined
        ? this.deps.github().then((gh) => gh.getIssue({ owner: repoRow.owner, name: repoRow.name }, firstIssueRef))
        : Promise.resolve(null),
    ]);

    const intent = intentOutcome.status === 'fulfilled' ? intentOutcome.value : undefined;
    if (!intent) missingInputs.push('derived intent was not available');

    const blast = blastOutcome.status === 'fulfilled' ? blastOutcome.value : undefined;
    if (!blast || blast.index_status === 'failed') missingInputs.push('blast radius / impact map was not available');

    const issue = issueOutcome.status === 'fulfilled' ? issueOutcome.value : null;
    if (issueRefs.length > 0 && issueOutcome.status === 'rejected') {
      missingInputs.push('linked issue could not be fetched');
    }

    // Document selection (AC-11…AC-19, AC-56, AC-60, AC-61), raced against a
    // deadline (NFR-3) — on timeout, proceed with what ranked so far.
    const changedPaths = diff.files.map((f) => f.path);
    const docSelection = await this.selectDocuments(workspaceId, repoRow.id, changedPaths);
    if (docSelection.timedOut) missingInputs.push('document selection was cut short by its time budget');
    if (docSelection.kept.length === 0 && docSelection.ranked.length === 0) {
      missingInputs.push('brief was built without project documents');
    }

    // Prompt assembly — metadata only, never diff content (AC-3, NFR-4,
    // NFR-20). Every untrusted text is wrapped (AC-54, AC-55, NFR-21);
    // DevDigest's own computations (intent, blast, file list) are not
    // re-wrapped, matching `run-executor.ts`.
    const fileList = renderBriefFileList(diff);
    const endpoints = new Set<string>(blast ? blast.downstream.flatMap((d) => d.endpoints_affected) : []);
    const filePaths = new Set<string>(changedPaths);

    // NFR-24: labelled, in the fixed priority order `enforceInputBudget`
    // drops from the tail of (highest priority first, dropped last) —
    // `changed-files` → `derived-intent` → `blast-radius` → `pr-title-body`
    // → `linked-issue` → one entry per document, lowest-ranked document
    // first (the SAME order `applyDocLimits` already kept them in).
    const sections: BriefSection[] = [];
    sections.push({ label: 'changed-files', text: `### Changed files\n${fileList}` });
    if (intent) {
      sections.push({
        label: 'derived-intent',
        text: `### Derived intent\nIntent: ${intent.intent}\nIn scope: ${intent.inScope.join('; ')}\nOut of scope: ${intent.outOfScope.join('; ')}`,
      });
    }
    if (blast) {
      const summary = blast.index_stale
        ? `${blast.summary}\n(Note: this impact map describes an older commit than the diff under review.)`
        : blast.summary;
      sections.push({ label: 'blast-radius', text: `### Blast radius\n${summary}` });
    }
    const prBodyCapped = (pull.body ?? '').slice(0, MAX_BRIEF_BODY_CHARS);
    sections.push({
      label: 'pr-title-body',
      text: `### PR title and body\n${wrapUntrusted('pr-body', `${pull.title}\n\n${prBodyCapped}`)}`,
    });
    if (issue) {
      const issueBodyCapped = (issue.body ?? '').slice(0, MAX_BRIEF_ISSUE_CHARS);
      sections.push({
        label: 'linked-issue',
        text: `### Linked issue\n${wrapUntrusted('linked-issue', `${issue.title}\n\n${issueBodyCapped}`)}`,
      });
    }
    // Documents are the most expendable (Rationale, NFR-24) — appended AFTER
    // every other section, lowest-ranked-kept document last, so a budget
    // drop takes the weakest document match first, then whole documents in
    // ranked order, before ever touching `linked-issue` or anything ahead of it.
    for (const doc of docSelection.kept) {
      sections.push({
        label: `document:${doc.path}`,
        text: `### Document: ${doc.path}\n${wrapUntrusted(`doc-${doc.path}`, doc.content)}`,
      });
    }

    const budgeted = enforceInputBudget(sections, this.deps.tokenizer.count.bind(this.deps.tokenizer));
    if (budgeted.droppedSections.length > 0) {
      missingInputs.push(
        `input budget (${MAX_BRIEF_INPUT_TOKENS} tokens) required dropping: ${budgeted.droppedSections.join(', ')}`,
      );
    }

    const userSections = budgeted.kept.map((s) => s.text);
    if (missingInputs.length > 0) {
      userSections.push(`### Missing inputs\n${missingInputs.map((m) => `- ${m}`).join('\n')}`);
    }

    const system = await renderPrompt('brief.system.md', {});
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: userSections.join('\n\n') },
    ];

    // Exactly one structured model call (AC-4). A throw after retries becomes
    // a reported failure WITHOUT writing the row, so the stored brief
    // survives (AC-40, AC-59, NFR-10).
    const llm = await this.deps.llm(model.provider);
    let result;
    try {
      result = await llm.completeStructured({
        model: model.model,
        schema: PrBriefSchema,
        schemaName: 'PrBrief',
        messages,
        maxRetries: 2,
      });
    } catch (err) {
      throw new AppError(
        'brief_generation_failed',
        `Brief generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        502,
      );
    }

    // Reference validation (AC-20…AC-26) against the assembled input — the
    // model proposes, the input data disposes. Persist the validated body
    // only, never the raw response (NFR-22).
    const lineIndex = buildBriefLineIndex(diff);
    const validated = validateReferences(
      { risks: result.data.risks, reviewFocus: result.data.review_focus },
      { filePaths, endpoints, lineIndex },
    );

    const body: PrBrief = {
      what: result.data.what,
      why: result.data.why,
      risk_level: result.data.risk_level,
      risks: validated.risks.slice(0, MAX_BRIEF_RISKS),
      review_focus: validated.reviewFocus.slice(0, MAX_BRIEF_FOCUS),
    };

    const provenance: BriefProvenance = {
      head_sha: headSha,
      indexed_sha: blast ? blast.indexed_sha : null,
      index_stale: blast ? blast.index_stale : false,
      generated_at: new Date().toISOString(),
      missing_inputs: missingInputs,
      selected_docs: docSelection.kept.map((d, i) => ({ path: d.path, rank: i + 1 })),
      dropped_docs: docSelection.dropped,
      // NFR-24: whole sections dropped to fit `MAX_BRIEF_INPUT_TOKENS`, in the
      // order dropped (lowest priority first). A document section's label is
      // `document:<path>`, distinguishing it from a per-document drop already
      // recorded in `dropped_docs` above (that drop happens BEFORE assembly,
      // from the candidate ranking; this one happens AFTER assembly, from the
      // token budget, and can only ever remove documents that were selected).
      dropped_sections: budgeted.droppedSections,
      rejected_entries: validated.rejected,
      model: result.model,
      provider: model.provider,
      // `?? null`, never `|| null` — `0` is a real token count / a real price,
      // not an absent one (server/INSIGHTS.md on `costUsd`).
      tokens_in: result.tokensIn ?? null,
      tokens_out: result.tokensOut ?? null,
      cost_usd: result.costUsd ?? null,
      cost_source: result.costSource ?? null,
      retries: result.attempts - 1,
    };

    // Persist against the head sha captured at the start of generation, not
    // re-read after the model call (AC-33).
    await this.deps.repo.upsertBrief(prId, body, provenance);

    // Why Timeline (0003): prune AFTER the upsert, never before — pruning
    // first could delete a row the upsert then fails to replace.
    await this.deps.repo.pruneBriefs(prId, MAX_BRIEF_HISTORY);

    return body;
  }

  /**
   * Documents: discover → contain-check every path BEFORE any read (AC-56) →
   * rank from paths alone (AC-61) → apply the count/token limits, reading
   * content only for the kept head. Races the whole selection against
   * `DOC_SELECT_BUDGET_MS` (NFR-3); on timeout, proceeds with what ranked.
   */
  private async selectDocuments(
    workspaceId: string,
    repoId: string,
    changedPaths: string[],
  ): Promise<{
    kept: { path: string; content: string }[];
    dropped: { path: string; limit: 'count' | 'tokens' }[];
    ranked: { path: string; score: number }[];
    timedOut: boolean;
  }> {
    let timedOut = false;
    const timer = new Promise<'timeout'>((resolve) => {
      const t = setTimeout(() => {
        timedOut = true;
        resolve('timeout');
      }, DOC_SELECT_BUDGET_MS);
      t.unref?.();
    });

    const work = (async () => {
      const listing = await this.deps.contextDocReader.listDocuments(workspaceId, repoId);
      const contained = listing.docs.map((d) => d.path).filter((p) => isContainedPath(p));
      const ranked = rankDocuments(contained, changedPaths);

      // A throw AND a `''` return from readFile both mean "missing"
      // (server/INSIGHTS.md) — tokensOf degrades to 0 for either, so a
      // vanished document just scores no budget rather than failing selection.
      const contentCache = new Map<string, string>();
      const readContent = async (path: string): Promise<string> => {
        const cached = contentCache.get(path);
        if (cached !== undefined) return cached;
        let content = '';
        try {
          const doc = await this.deps.contextDocReader.readDocument(workspaceId, repoId, path);
          content = doc?.content ?? '';
        } catch {
          content = '';
        }
        contentCache.set(path, content);
        return content;
      };

      const limited = await applyDocLimitsAsync(ranked, readContent, this.deps.tokenizer.count.bind(this.deps.tokenizer));
      return { ...limited, ranked };
    })();

    const raced = await Promise.race([work, timer]);
    if (raced === 'timeout') {
      return { kept: [], dropped: [], ranked: [], timedOut: true };
    }
    return { ...raced, timedOut };
  }
}

/**
 * Async wrapper around the pure `applyDocLimits` (helpers.ts): reads content
 * only for the ranking's head (selection itself scores from paths alone,
 * AC-61), then hands `tokensOf` — backed by the already-read content — to the
 * pure limiter so the count/token caps stay pure and unit-testable.
 */
async function applyDocLimitsAsync(
  ranked: { path: string; score: number }[],
  readContent: (path: string) => Promise<string>,
  countTokens: (text: string) => number,
): Promise<{ kept: { path: string; content: string }[]; dropped: { path: string; limit: 'count' | 'tokens' }[] }> {
  const contents = new Map<string, string>();
  for (const d of ranked) {
    contents.set(d.path, await readContent(d.path));
  }
  const { kept, dropped } = applyDocLimits(ranked, (path) => countTokens(contents.get(path) ?? ''));
  return {
    kept: kept.map((d) => ({ path: d.path, content: contents.get(d.path) ?? '' })),
    dropped,
  };
}
