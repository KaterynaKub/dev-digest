"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /** `useCancelRun()` — POST /runs/:id/cancel, keyed by run id. */
  cancelMutation: UseMutationResult<{ ok: boolean }, Error, string>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
  /** A finding to focus/scroll to (e.g. from a Smart Diff mark click). */
  targetFindingId?: string | null;
  /** Bumped by the caller to re-trigger the scroll on a repeat click. */
  targetFindingNonce?: number;
  /** Called when `targetFindingId` is set but no run in `runs` contains it,
   *  so the caller can clear the stale `?finding=` param. Does not render an
   *  error — the reviewer is already on the findings list, a reasonable
   *  place to be. */
  onFindingNotFound?: (id: string) => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  onOpenTrace,
  onDelete,
  onRunDone,
  targetFindingId = null,
  targetFindingNonce = 0,
  onFindingNotFound,
}: FindingsTabProps) {
  // A ReviewRecord carries no cost — the figure lives on the agent run that
  // produced it, which we already hold. Index the runs so each accordion can be
  // handed its own cost without refetching.
  const runById = React.useMemo(
    () => new Map((prRuns ?? []).map((r) => [r.run_id, r])),
    [prRuns],
  );

  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Review-runs navigation: opens + scrolls to a run's accordion below.
  // Two drivers set this state: the Timeline (clicking an agent name — by run
  // id) and a Smart Diff mark click forwarded from the page (by finding id,
  // via the effect below). The nonce re-triggers the scroll even when the
  // same target is clicked twice.
  const [target, setTarget] = React.useState<{
    runId: string | null;
    findingId: string | null;
    n: number;
  } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, findingId: null, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Smart Diff → Review-runs navigation: keyed on both id and nonce so a
  // repeat click on the same badge re-fires even though `targetFindingId`
  // itself would not have changed.
  React.useEffect(() => {
    if (!targetFindingId) return;
    setTarget({ runId: null, findingId: targetFindingId, n: targetFindingNonce });
  }, [targetFindingId, targetFindingNonce]);

  React.useEffect(() => {
    if (!targetFindingId) return;
    const found = runs.some((review) => review.findings.some((f) => f.id === targetFindingId));
    if (!found) onFindingNotFound?.(targetFindingId);
  }, [targetFindingId, runs, onFindingNotFound]);

  // Per-run findings for the timeline's severity chips. Joined from the reviews
  // we already hold (review.run_id ↔ run.run_id), so the timeline needs no
  // extra request. One run can yield more than one review row, hence the concat.
  const findingsByRunId = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const review of runs) {
      if (!review.run_id) continue;
      const prev = m.get(review.run_id);
      m.set(review.run_id, prev ? [...prev, ...review.findings] : review.findings);
    }
    return m;
  }, [runs]);

  return (
    <section>
      <IntentCard prId={prId} />

      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRunId={findingsByRunId}
            repoFullName={repoFullName}
            headSha={headSha}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            costUsd={review.run_id ? runById.get(review.run_id)?.cost_usd ?? null : null}
            costSource={review.run_id ? runById.get(review.run_id)?.cost_source ?? null : null}
            targetRunId={target?.runId ?? null}
            targetFindingId={target?.findingId ?? null}
            targetNonce={target?.n ?? 0}
          />
        ))
      )}
    </section>
  );
}
