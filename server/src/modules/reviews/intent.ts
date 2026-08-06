/**
 * IntentDeriver — the classifier call (application service, layer 4). Ports
 * reach it as an explicit deps object, never the Container. Imports only
 * `@devdigest/shared` types, its own `repository.js` types, `./intent-inputs.js`,
 * `./constants.js`, `./link-cache.js`, `platform/errors.js`,
 * `platform/run-logger.js`, `platform/prompts.js`, and
 * `adapters/http/ip-guard.js` (a PURE, dependency-free layer-2 helper — the
 * one exception to "no adapters", since it holds no I/O of its own). Never
 * `Container`, `db/**`, `drizzle-orm`, an adapter with real I/O, `fastify`,
 * `node:dns`, or `undici` — the port (`HttpFetcher`) is the only way this
 * file reaches the network.
 */
import type {
  FeatureModelChoice,
  GitClient,
  GitHubClient,
  HttpFetcher,
  Intent,
  LLMProvider,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import { Intent as IntentSchema } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { renderPrompt } from '../../platform/prompts.js';
import type { RunLogger } from '../../platform/run-logger.js';
import { hostMatchesAllowlist, normaliseHost } from '../../adapters/http/ip-guard.js';
import type { ReviewRepository, PullRow, RepoRow } from './repository.js';
import {
  parseExternalLinks,
  parseIssueRefs,
  parseSpecPaths,
  renderFileList,
  estimateTokens,
} from './intent-inputs.js';
import {
  DEFAULT_INTENT_MODEL,
  LINK_TOTAL_BUDGET_MS,
  MAX_INTENT_BODY_CHARS,
  MAX_INTENT_ISSUE_CHARS,
  MAX_INTENT_SPEC_CHARS,
} from './constants.js';
import { linkCache } from './link-cache.js';

/** Ports IntentDeriver needs, injected explicitly — never the Container. */
export interface IntentDeriverDeps {
  repo: ReviewRepository;
  git: GitClient;
  /** Resolver: a missing GitHub token must fail one derivation, not app startup. */
  github: () => Promise<GitHubClient>;
  /** Resolver, matching the existing `llm: (provider) => …` convention. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  httpFetcher: HttpFetcher;
  /** Resolver reading workspace settings — same reason as `intentModel`. */
  linkAllowlist: (workspaceId: string) => Promise<string[]>;
}

interface DeriveArgs {
  workspaceId: string;
  pull: PullRow;
  repoRow: RepoRow;
  diff: UnifiedDiff;
  model: FeatureModelChoice;
  force: boolean;
  runLog?: RunLogger;
}

/** A source contributed content: label used for wrapUntrusted + which body text was added. */
interface AssembledSource {
  label: string;
  kind: 'pr_title' | 'pr_body' | 'linked_issue' | 'spec_file' | 'external_link' | 'file_list';
  text: string;
}

function log(runLog: RunLogger | undefined, msg: string): void {
  runLog?.info(msg);
}

export class IntentDeriver {
  constructor(private deps: IntentDeriverDeps) {}

  async derive(args: DeriveArgs): Promise<{ intent: Intent; reused: boolean } | null> {
    const { workspaceId, pull, diff, model, force, runLog } = args;

    // 1. Freshness — reuse a stored intent when the head sha matches and the
    //    caller didn't force a re-derive. No model call, no cost.
    if (!force) {
      const stored = await this.deps.repo.getIntent(pull.id);
      if (stored && stored.head_sha === pull.headSha) {
        log(runLog, `intent: reusing stored intent for head ${pull.headSha.slice(0, 7)}`);
        const { head_sha: _headSha, derived_at: _derivedAt, ...intent } = stored;
        return { intent, reused: true };
      }
    }

    // 2. Assemble inputs. Every failure is caught individually and becomes a
    //    missing_context entry — this method never throws for an expected gap.
    const missing: string[] = [];
    const sources: AssembledSource[] = [];

    const title = pull.title;
    sources.push({ label: 'pr-title', kind: 'pr_title', text: title });

    const rawBody = pull.body ?? '';
    const bodyEmpty = rawBody.trim().length === 0;
    const body = rawBody.slice(0, MAX_INTENT_BODY_CHARS);
    if (!bodyEmpty) sources.push({ label: 'pr-body', kind: 'pr_body', text: body });

    // Linked issues (regex-parsed from the PR body; PrDetail.linked_issue is
    // NOT persisted, so this must fetch it itself).
    const issueRefs = parseIssueRefs(rawBody);
    const issueBodies: string[] = [];
    for (const n of issueRefs) {
      try {
        const github = await this.deps.github();
        const issue = await github.getIssue({ owner: args.repoRow.owner, name: args.repoRow.name }, n);
        const issueBody = (issue.body ?? '').slice(0, MAX_INTENT_ISSUE_CHARS);
        issueBodies.push(issueBody);
        sources.push({ label: `issue-${n}`, kind: 'linked_issue', text: `${issue.title}\n\n${issueBody}` });
      } catch (err) {
        missing.push(`linked issue #${n} could not be fetched`);
        log(runLog, `intent: issue #${n} fetch failed — ${(err as Error).message}`);
      }
    }

    // Spec / plan docs referenced in the body or any fetched issue body.
    const specPaths = parseSpecPaths([rawBody, ...issueBodies].join('\n'));
    for (const path of specPaths) {
      try {
        const content = await this.deps.git.readFile(
          { owner: args.repoRow.owner, name: args.repoRow.name },
          path,
        );
        // SimpleGitClient.readFile throws on a missing file; MockGitClient.readFile
        // returns '' for one not in its fixture map — both degrade to "not found"
        // (server/INSIGHTS.md).
        if (content.trim().length === 0) {
          missing.push(`spec/plan "${path}" could not be found`);
          continue;
        }
        sources.push({
          label: `spec-${path}`,
          kind: 'spec_file',
          text: content.slice(0, MAX_INTENT_SPEC_CHARS),
        });
      } catch (err) {
        missing.push(`spec/plan "${path}" could not be fetched`);
        log(runLog, `intent: spec "${path}" read failed — ${(err as Error).message}`);
      }
    }

    // External links — deny-by-default allowlist gate BEFORE any network call.
    const allowlist = await this.deps.linkAllowlist(workspaceId);
    log(
      runLog,
      allowlist.length === 0
        ? 'intent: link allowlist is empty — external links will be skipped'
        : `intent: link allowlist has ${allowlist.length} entr${allowlist.length === 1 ? 'y' : 'ies'}`,
    );
    const candidateLinks = parseExternalLinks([rawBody, ...issueBodies].join('\n'));
    const linkDeadline = Date.now() + LINK_TOTAL_BUDGET_MS;
    for (const { url, scheme } of candidateLinks) {
      if (scheme !== 'https') {
        missing.push(`external link not fetched (insecure scheme): ${url}`);
        continue;
      }
      let host: string;
      try {
        host = normaliseHost(new URL(url).hostname);
      } catch {
        missing.push(`external link not fetched (invalid URL): ${url}`);
        continue;
      }
      if (allowlist.length === 0 || !hostMatchesAllowlist(host, allowlist)) {
        missing.push(`external link not fetched (not on allowlist): ${url}`);
        log(runLog, `link: ${host} — skipped (${allowlist.length === 0 ? 'allowlist has 0 entries' : 'not on allowlist'})`);
        continue; // no cache read, NO network call
      }
      if (Date.now() >= linkDeadline) {
        missing.push(`external link not fetched (time budget exceeded): ${url}`);
        continue;
      }
      const t0 = Date.now();
      const { value, cached } = await linkCache.wrap(url, () => this.deps.httpFetcher.get(url, { allowlist }));
      const elapsedMs = Date.now() - t0;
      if (!value.ok) {
        const reason = humanFetchFailureReason(value.failure.reason, value.failure.status);
        missing.push(`external link not fetched (${reason}): ${url}`);
        log(runLog, `link: ${host} — ${value.failure.reason}${value.failure.status ? ` (HTTP ${value.failure.status})` : ''}`);
        continue;
      }
      if (cached) {
        log(runLog, `link: ${host} — cache hit`);
      } else {
        const sizeKb = (value.doc.bytes / 1024).toFixed(1);
        log(
          runLog,
          `link: ${host} — ${value.doc.status}, ${value.doc.contentType}, ${sizeKb} KB${value.doc.truncated ? ' (truncated)' : ''}, ${elapsedMs}ms`,
        );
      }
      sources.push({ label: `external-${host}`, kind: 'external_link', text: value.doc.text });
    }

    // File list + hunk headers — no line content, ever.
    const fileList = renderFileList(diff);
    if (fileList.length > 0) sources.push({ label: 'file-list', kind: 'file_list', text: fileList });

    log(
      runLog,
      `intent: sources=[${sources.map((s) => s.kind).join(',')}] issue=${issueRefs.length} spec=${specPaths.length} files=${diff.files.length}`,
    );

    // 3. Build the messages. Every source body is wrapped as untrusted DATA;
    //    only trusted section headers we write ourselves are outside the wrap.
    const system = await renderPrompt('intent.system.md', {});
    const userSections = sources.map((s) => `### ${s.label}\n${wrapUntrusted(s.label, s.text)}`);
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: userSections.join('\n\n') },
    ];

    const isDefault = model.provider === DEFAULT_INTENT_MODEL.provider && model.model === DEFAULT_INTENT_MODEL.model;
    log(runLog, `intent: model=${model.provider}/${model.model} (${isDefault ? 'default' : 'override'})`);
    log(runLog, `intent: ~${estimateTokens(messages.map((m) => m.content).join('\n'))} prompt token(s)`);

    // 4. The structured call.
    const llm = await this.deps.llm(model.provider);
    const result = await llm.completeStructured({
      model: model.model,
      schema: IntentSchema,
      schemaName: 'PrIntent',
      messages,
      maxRetries: 2,
    });

    // 5. Post-process defensively — the model is cheap, code wins.
    let confidence = result.data.confidence ?? null;
    if (confidence != null) confidence = Math.min(1, Math.max(0, confidence));
    if (bodyEmpty) confidence = confidence == null ? 0.4 : Math.min(confidence, 0.4);

    const codeMissing = missing;
    const modelMissing = result.data.missing_context ?? [];
    const mergedMissing = Array.from(new Set([...codeMissing, ...modelMissing]));

    const assembledKinds = new Set(sources.map((s) => s.kind));
    const claimedSources = result.data.sources ?? [];
    const finalSources = claimedSources.filter((s) => assembledKinds.has(s));
    // external_link appears ONLY when a document was actually fetched.
    if (!assembledKinds.has('external_link')) {
      const idx = finalSources.indexOf('external_link');
      if (idx >= 0) finalSources.splice(idx, 1);
    }

    const intent: Intent = {
      intent: result.data.intent,
      in_scope: result.data.in_scope,
      out_of_scope: result.data.out_of_scope,
      confidence,
      sources: finalSources,
      missing_context: mergedMissing,
    };

    log(
      runLog,
      `intent: confidence=${confidence ?? 'unknown'}, ${intent.in_scope.length} in-scope, ${intent.out_of_scope.length} out-of-scope, ${mergedMissing.length} missing-context note(s)`,
    );

    // 6. Persist.
    await this.deps.repo.upsertIntent(pull.id, intent, pull.headSha);

    return { intent, reused: false };
  }
}

function humanFetchFailureReason(reason: string, status?: number): string {
  switch (reason) {
    case 'not_allowlisted':
      return 'not on allowlist';
    case 'bad_scheme':
      return 'insecure scheme';
    case 'blocked_address':
      return 'blocked address';
    case 'dns_failed':
      return 'DNS lookup failed';
    case 'redirect_host_changed':
      return 'redirected to a different host';
    case 'too_many_redirects':
      return 'too many redirects';
    case 'timeout':
      return 'timed out';
    case 'too_large':
      return 'too large';
    case 'unsupported_content_type':
      return 'unsupported content type';
    case 'http_error':
      return status ? `HTTP ${status}` : 'HTTP error';
    default:
      return 'network error';
  }
}
