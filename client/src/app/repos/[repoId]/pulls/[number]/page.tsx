/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubBlobUrl, githubPrUrl } from "@/lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  const targetFindingId = search.get("finding");
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);

  const [findingNonce, setFindingNonce] = React.useState(0);
  /** Jump to a finding's card in the Findings tab. Sets ?tab and ?finding in
   *  ONE replace — two setParam calls would race on the captured `search`. */
  const goToFinding = React.useCallback(
    (findingId: string) => {
      const sp = new URLSearchParams(search.toString());
      sp.set("tab", "findings");
      sp.set("finding", findingId);
      router.replace(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
      // Clicking the same badge twice produces an identical URL — no param
      // change, no re-render — but the reviewer who scrolled away still
      // expects to be brought back. Deliberately NOT in the URL: a nonce is
      // not part of what a shared link carries.
      setFindingNonce((n) => n + 1);
    },
    [search, router, repoId, number],
  );

  // BLAST RADIUS caller → the code it names. Two destinations on purpose, because
  // a caller is ordinary repository code and is USUALLY in a file this PR never
  // touched: the diff simply has no row for it. So a caller inside the PR opens
  // the Diff tab at that line (staying in the studio, where the reviewer keeps
  // their findings and comments), and one outside it opens the file on GitHub at
  // the PR's head sha. The alternative — making only in-PR callers clickable —
  // would leave most of the map dead to the pointer.
  const [blastTarget, setBlastTarget] = React.useState<{
    file: string;
    line: number;
    nonce: number;
  } | null>(null);
  const changedPaths = React.useMemo(
    () => new Set((pr?.files ?? []).map((f) => f.path)),
    [pr?.files],
  );
  const goToLocation = React.useCallback(
    (file: string, line: number, sha: string | null, pin: "index" | "head") => {
      // Two different callers share this callback and MUST NOT share its
      // staleness rule. Blast's coordinates (`pin: "index"`) are only valid
      // against the commit the indexer walked, so a stale index forces even an
      // in-PR file out to GitHub. A brief's coordinates (`pin: "head"`) come
      // straight from the diff (AC-45) — they are never stale, because the
      // diff IS the head — so that check is skipped entirely for them.
      const staleForDiff = pin === "index" && sha != null && pr != null && sha !== pr.head_sha;
      if (changedPaths.has(file) && !staleForDiff) {
        // Nonce, not the file/line pair: clicking the SAME caller twice is an
        // identical target, and a reviewer who scrolled away still expects to be
        // taken back (same reasoning as `findingNonce` above).
        setBlastTarget((prev) => ({ file, line, nonce: (prev?.nonce ?? 0) + 1 }));
        // URL built inline rather than through `setParam`, matching
        // `goToFinding` above: `setParam` is redefined every render, so
        // depending on it would rebuild this callback on each one.
        const sp = new URLSearchParams(search.toString());
        sp.set("tab", "diff");
        router.replace(`/repos/${repoId}/pulls/${number}?${sp.toString()}`);
        return;
      }
      // Reads `activeRepo` rather than the `repoFullName` alias below, which is
      // declared further down the component — same value, no forward reference.
      const fullName = activeRepo?.full_name ?? null;
      // Nothing to open without the owner/repo or a commit to resolve against: a
      // blob URL guessed from a partial identity would 404 rather than fail visibly.
      if (!fullName || !pr) return;
      // `pin === "head"`: always `pr.head_sha`, never `sha` — a brief
      // coordinate is never resolved against the index (AC-45). `pin ===
      // "index"`: `sha` (the indexed_sha) FIRST, `head_sha` only as a
      // fallback. The line number was recorded by the indexer against the
      // commit it walked, so that is the only tree where it points at the
      // right code — against the PR head it lands on whatever now occupies
      // that line, which is how a caller ended up pointing at a `*/` in the
      // middle of a comment block. The fallback exists solely for a null
      // `indexed_sha` (no index at all), where a best-effort link beats a dead
      // one.
      const blobSha = pin === "head" ? pr.head_sha : (sha ?? pr.head_sha);
      window.open(
        githubBlobUrl(fullName, blobSha, file, line),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [changedPaths, activeRepo, pr, search, router, repoId, number],
  );

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  // Cheap flatMap over an already-fetched list — derived during render rather
  // than memoised (the previous useMemo keyed on `reviews` while reading `runs`).
  const allFindings: FindingRecord[] = runs.flatMap((r) => r.findings);
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prBody={pr.body}
            prId={prId}
            repoId={repoId}
            headSha={pr.head_sha}
            onGoToLocation={goToLocation}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
            targetFindingId={targetFindingId}
            targetFindingNonce={findingNonce}
            onFindingNotFound={() => setParam("finding", null)}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            findings={allFindings}
            onGoToFinding={goToFinding}
            targetLocation={blastTarget}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
