import type { GitHubClient } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { PollingRepository } from './repository.js';

export interface PollResult {
  synced: number;
  reviewTriggered: false;
}

/**
 * Ports this service needs. Injected explicitly — never the whole Container,
 * and never `Db`: persistence stays behind the repository.
 */
export interface PollingDeps {
  repo: PollingRepository;
  /** Lazily resolved: a missing GITHUB_TOKEN must fail the poll, not startup. */
  github: () => Promise<GitHubClient>;
}

/**
 * F1 — polling use cases. Syncs the PR list for one repo from GitHub.
 *
 * Polling NEVER triggers a review — review is always user-initiated.
 * Auto-review here would spend LLM budget without consent.
 */
export class PollingService {
  private repo: PollingRepository;

  constructor(private deps: PollingDeps) {
    this.repo = deps.repo;
  }

  /** Sync the PR list from GitHub and bump `last_polled_at`. */
  async pollRepo(workspaceId: string, repoId: string): Promise<PollResult> {
    const repo = await this.repo.findRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.deps.github();
    // Only open PRs are listed; a PR merged upstream keeps its last-known
    // local status.
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });

    let synced = 0;
    for (const pr of pulls) {
      await this.repo.upsertPullRequest(workspaceId, repo.id, pr);
      synced++;
    }
    await this.repo.markPolled(repo.id);

    return { synced, reviewTriggered: false };
  }
}
