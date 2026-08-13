import type { BlastRadius } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { buildBlastRadius } from './helpers.js';
import type { BlastRepository } from './repository.js';
import type { RepoIntel } from '../repo-intel/types.js';

/**
 * No `llm` on purpose — blast makes no model call, ever. Mirrors the
 * discipline of `smart-diff/service.ts#SmartDiffDeps`.
 */
export interface BlastDeps {
  repo: BlastRepository;
  /** repo-intel facade PORT — never the Container, never repo-intel/pipeline/**. */
  repoIntel: RepoIntel;
}

export function blastDeps(container: { blastRepo: BlastRepository; repoIntel: RepoIntel }): BlastDeps {
  return { repo: container.blastRepo, repoIntel: container.repoIntel };
}

export class BlastService {
  constructor(private deps: BlastDeps) {}

  /** Orchestration only — the flat→grouped transform lives entirely in helpers.ts. */
  async forPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = await this.deps.repo.getPrFiles(prId);
    if (paths.length === 0) {
      // A PR that changed no files has a genuinely empty, FULL-index map —
      // this is a fact ("no files changed"), not a data gap, so repoIntel is
      // not even called.
      return buildBlastRadius(
        { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false },
        { status: 'full' },
      );
    }

    // Parallel, per §4.4 step 3 — each read is independent and each is
    // guarded on its own so one throwing never masks the other's result.
    const [blastOutcome, indexOutcome] = await Promise.allSettled([
      this.deps.repoIntel.getBlastRadius(pull.repoId, paths),
      this.deps.repoIntel.getIndexState(pull.repoId),
    ]);

    if (blastOutcome.status === 'rejected') {
      // Never propagate the throw and never fall back to a silent empty
      // array — a caller that can't tell "index failed" from "no impact"
      // would misreport a real gap as safety. §4.4 step 4.
      return buildBlastRadius(
        { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'index_failed' },
        null,
      );
    }

    // `getIndexState` "ALWAYS works, even degraded" per repo-intel/types.ts,
    // but this service still treats a throw here as "state unknown" rather
    // than trusting blastResult to imply 'full'.
    const indexState = indexOutcome.status === 'fulfilled' ? indexOutcome.value : null;

    return buildBlastRadius(blastOutcome.value, indexState);
  }
}
