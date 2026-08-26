/* BlastRadiusCard — "BLAST RADIUS": maps a PR's changed symbols to their
   downstream callers, HTTP endpoints, and cron jobs, read from the
   repo-intel index (server/src/modules/blast). A Tree/Graph toggle switches
   between the two views over the SAME `downstream[]` data — Graph is an
   inline-SVG, deterministic two-layer layout (spec 0007-blast-radius.md
   §6.2, iteration 2), not a separate fetch or a force simulation.

   Two DIFFERENT empty states — do not collapse them into one:
     - `degraded === false` + no downstream → a plain fact ("no callers
       found"), rendered via `blast.noDownstream`.
     - `degraded === true`  → an index-state banner (with `reason` and a
       Resync action), NEVER "no downstream callers found". Reporting zero
       impact on an incomplete index is the one thing this component must
       never do — see specs/0007-blast-radius.md §9 acceptance criteria. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel, Skeleton, Button, ErrorState, Modal } from "@devdigest/ui";
import { useBlast } from "@/lib/hooks/reviews";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { useDirtyContextDocs } from "@/lib/hooks/project-context";
import type { DownstreamImpact } from "@devdigest/shared";
import { BlastGraph } from "./_components/BlastGraph";
import { DEGRADED_INDEX_STATUSES } from "./constants";
import { chevronFor, s } from "./styles";

export interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string | null;
  /**
   * Opens a caller's `file`:`line`. WHERE it opens is the host page's decision
   * (Diff tab for a file this PR changed, GitHub blob for one it did not) —
   * this card only reports which caller was clicked, and deliberately knows
   * nothing about the PR's file list or the repo's full name.
   *
   * `sha` is the commit those coordinates belong to (`indexed_sha`), passed
   * along because the card is the only place that holds it: a line number is
   * meaningless without the revision it was recorded against, and the host
   * would otherwise fall back to the PR head and land on unrelated text.
   *
   * Optional: without it the `file:line` renders as the plain text it always
   * was, so the card stays renderable outside a navigation host (same idiom as
   * `SmartDiffSection#onGoToFinding`).
   *
   * `pin` is always passed as `"index"` by this card — its coordinates come
   * from the repo-intel indexer, never from the diff (contrast `PrBriefCard`,
   * which always passes `"head"`). The host's `goToLocation` uses it to decide
   * whether staleness applies at all.
   */
  onGoToLocation?: (file: string, line: number, sha: string | null, pin: "index" | "head") => void;
}

type ViewMode = "tree" | "graph";

export function BlastRadiusCard({ prId, repoId, onGoToLocation }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = useBlast(prId);
  const resync = useResyncRepoIntel(repoId);
  const [view, setView] = React.useState<ViewMode>("tree");
  /* AC-22/AC-53 — re-indexing calls `sync()`, which is `git reset --hard`, so
     it destroys uncommitted edits to project-context documents in the clone.
     The user must see WHICH documents are at stake and confirm before the
     mutation fires. The server already scopes this list to `*.md` under the
     configured roots (AC-66) — never re-filter or widen it here. */
  const tContext = useTranslations("context");
  const dirty = useDirtyContextDocs(repoId);
  const [confirmingResync, setConfirmingResync] = React.useState(false);
  const dirtyPaths = dirty.data?.paths ?? [];

  const requestResync = () => {
    if (dirtyPaths.length > 0) {
      setConfirmingResync(true);
      return;
    }
    resync.mutate();
  };
  const [openSymbols, setOpenSymbols] = React.useState<Record<string, boolean>>({});

  const toggleSymbol = (symbol: string) =>
    setOpenSymbols((prev) => ({ ...prev, [symbol]: !prev[symbol] }));

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <div style={s.loadingLine} role="status" aria-live="polite">
          <Icon.RefreshCw size={14} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span>{t("loading")}</span>
        </div>
        <Skeleton height={16} width="60%" />
        <div style={{ height: 10 }} />
        <Skeleton height={60} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={s.wrap}>
        <SectionLabel icon="Zap">{t("title")}</SectionLabel>
        <ErrorState body={t("error")} onRetry={() => refetch()} />
      </div>
    );
  }

  const isDegraded = data.degraded || DEGRADED_INDEX_STATUSES.has(data.index_status);
  const endpointsCount = new Set(data.downstream.flatMap((d) => d.endpoints_affected)).size;
  const cronsCount = new Set(data.downstream.flatMap((d) => d.crons_affected)).size;
  const callersCount = data.downstream.reduce((sum, d) => sum + d.callers.length, 0);

  const degradedKey =
    data.index_status === "partial" ? "degraded.partial" : "degraded.degraded";

  return (
    <div style={s.wrap}>
      <SectionLabel
        icon="Zap"
        right={
          <div style={s.headerActions}>
            <div style={s.toggleWrap} role="group">
              <button
                type="button"
                style={s.toggleButton(view === "tree")}
                aria-pressed={view === "tree"}
                onClick={() => setView("tree")}
              >
                {t("view.tree")}
              </button>
              <button
                type="button"
                style={s.toggleButton(view === "graph")}
                aria-pressed={view === "graph"}
                onClick={() => setView("graph")}
              >
                {t("view.graph")}
              </button>
            </div>
            {/* Reindexing is available on EVERY state, not just the degraded
                banner it used to live in. A `full` index can still be stale —
                that is the case the banner never covered — and a reviewer who
                spots wrong line numbers needs the fix where they are looking,
                not only when the server has already admitted a problem. */}
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={resync.isPending}
              disabled={!repoId}
              onClick={requestResync}
            >
              {resync.isPending ? t("degraded.resyncing") : t("degraded.resync")}
            </Button>
          </div>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.statsRow}>
        <span style={s.stats} className="mono tnum">
          {data.changed_symbols.length} {t("stat.symbols")} · {callersCount} {t("stat.callers")} ·{" "}
          {endpointsCount} {t("stat.endpoints")} · {cronsCount} {t("stat.crons")}
        </span>
      </div>

      {isDegraded && (
        <div style={s.degradedBanner} role="status">
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0 }} />
          <div style={s.degradedBannerText}>
            <div>{t(degradedKey)}</div>
            {data.reason && (
              <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-muted)" }} className="mono">
                {data.reason}
              </div>
            )}
          </div>
          {/* No Resync button here any more — it moved to the card header, where
              it covers the stale-but-healthy case this banner never sees. */}
        </div>
      )}

      {/* Staleness is its own state, deliberately NOT folded into the degraded
          banner: the index is intact and `index_status` still means what it
          says — it simply describes an earlier commit, so the line numbers
          below point into that tree rather than the PR head. Rendered even when
          degraded is false, which is exactly when it would otherwise go
          unreported. */}
      {data.index_stale && (
        <div style={s.staleBanner} role="status">
          <Icon.Clock size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div style={s.degradedBannerText}>
            <div>{t("stale.body")}</div>
            {data.indexed_sha && (
              <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-muted)" }} className="mono">
                {t("stale.indexedAt", { sha: data.indexed_sha.slice(0, 7) })}
              </div>
            )}
          </div>
        </div>
      )}

      {!isDegraded && data.downstream.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("noDownstream", { count: data.changed_symbols.length })}
        </div>
      )}

      {!isDegraded && data.downstream.length > 0 && view === "tree" && (
        <div style={s.tree}>
          {data.downstream.map((symbol) => (
            <SymbolRow
              key={symbol.symbol}
              symbol={symbol}
              open={!!openSymbols[symbol.symbol]}
              onToggle={() => toggleSymbol(symbol.symbol)}
              callerCountLabel={t("callerCount", { count: symbol.callers.length })}
              onGoToLocation={
                onGoToLocation
                  ? (file, line) => onGoToLocation(file, line, data.indexed_sha ?? null, "index")
                  : undefined
              }
              openLocationLabel={(file, line) => t("openLocation", { file, line })}
            />
          ))}
        </div>
      )}

      {!isDegraded && data.downstream.length > 0 && view === "graph" && (
        <BlastGraph downstream={data.downstream} />
      )}

      {confirmingResync && (
        <Modal
          width={560}
          title={tContext("resyncWarning.title")}
          subtitle={tContext("resyncWarning.body")}
          onClose={() => setConfirmingResync(false)}
          footer={
            <>
              <Button kind="ghost" size="sm" onClick={() => setConfirmingResync(false)}>
                {tContext("resyncWarning.cancel")}
              </Button>
              <Button
                kind="primary"
                size="sm"
                loading={resync.isPending}
                onClick={() => {
                  setConfirmingResync(false);
                  resync.mutate();
                }}
              >
                {tContext("resyncWarning.confirm")}
              </Button>
            </>
          }
        >
          <div style={s.dirtyList}>
            {dirtyPaths.map((p) => (
              <span key={p} className="mono" style={s.dirtyPath}>
                {p}
              </span>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SymbolRow({
  symbol,
  open,
  onToggle,
  callerCountLabel,
  onGoToLocation,
  openLocationLabel,
}: {
  symbol: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  callerCountLabel: string;
  onGoToLocation?: (file: string, line: number) => void;
  /** Accessible name for the `file:line` button — the only string this row
   *  builds, and it comes from `messages/`, never from JSX. */
  openLocationLabel: (file: string, line: number) => string;
}) {
  return (
    <div style={s.symbolRow}>
      <div
        role="button"
        tabIndex={0}
        style={s.symbolHeader}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <Icon.ChevronRight size={14} style={chevronFor(open)} />
        <span style={s.symbolName} className="mono">
          {symbol.symbol}()
        </span>
        <Badge>{callerCountLabel}</Badge>
      </div>

      {open && (
        <div style={s.symbolCallers}>
          {symbol.callers.map((caller, i) => (
            <div key={`${caller.file}:${caller.line}:${i}`} style={s.callerRow}>
              <span className="mono">{caller.name}</span>
              {" — "}
              {/* Without a host the location stays exactly the plain text it
                  was: a button that navigates nowhere is worse than a label. */}
              {onGoToLocation ? (
                <button
                  type="button"
                  style={s.callerFileButton}
                  className="mono"
                  aria-label={openLocationLabel(caller.file, caller.line)}
                  onClick={() => onGoToLocation(caller.file, caller.line)}
                >
                  {caller.file}:{caller.line}
                </button>
              ) : (
                <span style={s.callerFile} className="mono">
                  {caller.file}:{caller.line}
                </span>
              )}
            </div>
          ))}

          {(symbol.endpoints_affected.length > 0 || symbol.crons_affected.length > 0) && (
            <div style={s.factsRow}>
              {symbol.endpoints_affected.map((ep) => (
                <Badge key={ep} color="var(--accent-text)" bg="var(--bg-hover)" mono style={s.factBadge}>
                  {ep}
                </Badge>
              ))}
              {symbol.crons_affected.map((cron) => (
                <Badge key={cron} color="var(--text-secondary)" bg="var(--bg-surface)" mono style={s.factBadge}>
                  {cron}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
