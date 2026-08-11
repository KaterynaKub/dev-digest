import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff } from './helpers.js';
import type { SmartDiffRepository } from './repository.js';

/** One member on purpose: Smart Diff makes no model call. Do not add `llm`. */
export interface SmartDiffDeps {
  repo: SmartDiffRepository;
}

export function smartDiffDeps(container: { smartDiffRepo: SmartDiffRepository }): SmartDiffDeps {
  return { repo: container.smartDiffRepo };
}

export class SmartDiffService {
  constructor(private deps: SmartDiffDeps) {}

  /** Orchestration only — classification logic lives entirely in helpers.ts. */
  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, findings] = await Promise.all([
      this.deps.repo.getPrFiles(prId),
      this.deps.repo.findingsForPull(prId),
    ]);

    return buildSmartDiff(files, findings);
  }
}
