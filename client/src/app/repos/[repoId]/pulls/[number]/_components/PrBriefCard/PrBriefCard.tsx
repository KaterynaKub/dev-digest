/* PrBriefCard — "PR BRIEF": the model's synthesis of what a PR changes, why,
   one risk level, named risks, and an ordered "read these first" list
   (SPEC-02). Renders above the INTENT/BLAST RADIUS grid in OverviewTab
   (AC-49, design finding D-10).

   Deliberately NOT the PR score / verdict / findings count shown in the
   design mockup's "PR BRIEF" band — that data belongs to a completed review
   (`VerdictBanner`), has a different source and a different lifecycle, and is
   explicitly out of scope here (spec Non-goals, design finding D-1). This
   card's risk level is a SEPARATE measurement and is labelled to read as one
   (AC-52).

   Every risk/review-focus reference already survived server-side grounding
   (AC-20…AC-24) before it reaches this component — nothing here re-validates
   a reference, it only renders what the server kept and reports what the
   server rejected. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import { useBrief, useGenerateBrief } from "@/lib/hooks/reviews";
import { formatCostUsd } from "@/lib/format";
import type { PrBriefRecord, Risk, ReviewFocusEntry } from "@devdigest/shared";
import { RISK_LEVEL_COLOR } from "./constants";
import { s } from "./styles";
import { BriefTimeline } from "./BriefTimeline";

export interface PrBriefCardProps {
  prId: string | null;
  /** Not read by this card today — kept for parity with `BlastRadiusCard`'s
   *  prop shape and because a future state (e.g. an empty-state deep-link)
   *  may need it. The card's own head sha comes from `provenance.head_sha`
   *  once a brief exists, which is the value that actually produced it. */
  repoId: string | null;
  /** Same as `repoId` — kept for the documented prop shape (this card's own
   *  states all read `provenance.head_sha` instead, since that is the sha the
   *  displayed brief was actually generated against, AC-34). */
  headSha: string | null;
  /**
   * Opens a `file`:`line`. Always called with `pin: "head"` — a brief's
   * coordinates come from the diff, never from the repo-intel index (AC-45),
   * so unlike `BlastRadiusCard` this card passes no `sha` of its own (`null`)
   * and lets the host resolve everything from the PR's head.
   *
   * Optional: without it every reference renders as inert text rather than a
   * dead link (AC-47).
   */
  onGoToLocation?: (file: string, line: number, sha: string | null, pin: "index" | "head") => void;
}

export function PrBriefCard({ prId, onGoToLocation }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = useBrief(prId);
  const generate = useGenerateBrief(prId);

  const handleGenerate = () => generate.mutate();

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.loadingLine} role="status" aria-live="polite">
          <Icon.RefreshCw size={14} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span>{t("title")}</span>
        </div>
        <Skeleton height={16} width="70%" />
        <div style={{ height: 10 }} />
        <Skeleton height={60} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={s.wrap}>
        <div style={s.errorWrap}>
          <Icon.AlertOctagon size={16} style={{ color: "var(--crit)" }} />
          <span>{t("failed.title")}</span>
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {t("regenerate")}
          </Button>
        </div>
      </div>
    );
  }

  // WHILE generating (AC-32, NFR-18): a status line names what is happening,
  // and the trigger button (whichever one fired it) shows `loading` — the
  // never-generated Button below, or the regenerate Button in the present
  // state, whichever is currently mounted.
  if (generate.isPending) {
    return (
      <div style={s.wrap}>
        <div style={s.headerRow}>
          <span style={s.titleGroup}>
            <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
              {t("title")}
            </span>
          </span>
        </div>
        <div style={s.loadingLine} role="status" aria-live="polite">
          <Icon.RefreshCw size={14} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span>{t("generating")}</span>
        </div>
        <Skeleton height={16} width="70%" />
        <div style={{ height: 10 }} />
        <Skeleton height={60} />
      </div>
    );
  }

  // Failed generation (AC-40, AC-59): report the reason, but never destroy a
  // previously stored brief — it renders below, unchanged, if one exists.
  const generateFailed = generate.isError;
  const failureReason = generate.error instanceof Error ? generate.error.message : null;

  const brief = data ?? null;

  if (!brief) {
    return (
      <div style={s.wrap}>
        {generateFailed && (
          <div style={s.noticeWarn} role="status">
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0 }} />
            <div style={s.noticeText}>
              <div>{t("failed.title")}</div>
              {failureReason && (
                <div style={{ marginTop: 4, fontSize: 11.5 }} className="mono">
                  {t("failed.reasonPrefix")} {failureReason}
                </div>
              )}
            </div>
          </div>
        )}
        <EmptyState
          icon="Sparkles"
          title={t("empty.title")}
          body={
            <>
              {t("empty.body")}
              <br />
              {t("empty.spendWarning")}
            </>
          }
          cta={t("empty.cta")}
          onCta={handleGenerate}
          ctaLoading={generate.isPending}
        />
      </div>
    );
  }

  const { risk_level, what, why, risks, review_focus, provenance } = brief;
  const missingInputs = provenance.missing_inputs ?? [];
  const rejectedEntries = provenance.rejected_entries ?? [];
  const allRejected = risks.length === 0 && review_focus.length === 0 && rejectedEntries.length > 0;

  // AC-47: no host, or no verified line to navigate to (AC-25) — inert, not
  // clickable, rather than a dead link. `sha` is always `null` and `pin` is
  // always `"head"`: a brief's coordinates come from the diff, never the
  // index, so the host resolves purely from the PR's own head sha (AC-45).
  const goTo = (file: string, line: number | null) => {
    if (!onGoToLocation || line == null) return undefined;
    return () => onGoToLocation(file, line, null, "head");
  };

  return (
    <div style={s.wrap}>
      {generateFailed && (
        <div style={s.noticeWarn} role="status">
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0 }} />
          <div style={s.noticeText}>
            <div>{t("failed.title")}</div>
            {failureReason && (
              <div style={{ marginTop: 4, fontSize: 11.5 }} className="mono">
                {t("failed.reasonPrefix")} {failureReason}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={s.headerRow}>
        <span style={s.titleGroup}>
          <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            {t("title")}
          </span>
          <span style={s.modelBadge}>{t("modelGenerated")}</span>
        </span>
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          loading={generate.isPending}
          onClick={handleGenerate}
        >
          {generate.isPending ? t("regenerating") : t("regenerate")}
        </Button>
      </div>

      <div style={s.riskLevelRow}>
        <span style={s.riskLevelLabel}>{t("riskLevel.label")}</span>
        <span style={s.riskLevelValue(RISK_LEVEL_COLOR[risk_level])}>{t(`riskLevel.${risk_level}`)}</span>
      </div>

      <div style={s.whatWhy}>
        <div style={s.what}>{what}</div>
        <div style={s.why}>{why}</div>
      </div>

      <div style={s.metaRow}>
        <span>{t("headSha", { sha: provenance.head_sha.slice(0, 7) })}</span>
        <span>{t("generatedAt", { time: new Date(provenance.generated_at).toLocaleString() })}</span>
        <CostLine provenance={provenance} />
      </div>

      {/* The `is_current` gap (0003 Requirements review): the server has
          always computed this, but nothing rendered it — a stale brief
          looked identical to a current one (AC-30). */}
      {brief.is_current === false && (
        <div style={s.notice} role="status">
          <Icon.Clock size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div style={s.noticeText}>{t("timeline.notCurrent")}</div>
        </div>
      )}

      <div style={s.notice}>
        <Icon.Info size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <div style={s.noticeText}>{t("metadataOnly")}</div>
      </div>

      {provenance.index_stale && (
        <div style={s.notice} role="status">
          <Icon.Clock size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div style={s.noticeText}>{t("staleIndex")}</div>
        </div>
      )}

      {missingInputs.length > 0 && (
        <div style={s.notice} role="status">
          <Icon.AlertTriangle size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div style={s.noticeText}>
            <div>{t("missingInputs")}</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {missingInputs.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {rejectedEntries.length > 0 && (
        <div style={s.noticeWarn} role="status">
          <Icon.AlertOctagon size={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0 }} />
          <div style={s.noticeText}>
            <div>{t("rejectedEntries")}</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {rejectedEntries.map((r, i) => (
                <li key={i}>{r.reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {allRejected && (
        <div style={s.noticeWarn} role="status">
          <Icon.AlertOctagon size={16} style={{ color: "var(--warn, #b45309)", flexShrink: 0 }} />
          <div style={s.noticeText}>{t("allRejected")}</div>
        </div>
      )}

      {risks.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionHeading}>
            <Icon.Shield size={13} />
            <span>{t("section.risks")}</span>
          </div>
          <div style={s.riskList}>
            {risks.map((risk, i) => (
              <RiskItem key={i} risk={risk} onGoTo={goTo} />
            ))}
          </div>
        </div>
      )}

      {review_focus.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionHeading}>
            <Icon.Target size={13} />
            <span>{t("section.reviewFocus")}</span>
            <Badge>{review_focus.length}</Badge>
          </div>
          <div style={s.focusList}>
            {review_focus.map((entry, i) => (
              <FocusItem key={i} index={i + 1} entry={entry} onGoTo={goTo} />
            ))}
          </div>
        </div>
      )}

      {provenance.selected_docs.length > 0 && (
        <div style={s.documentsRow}>
          <Icon.FileText size={12} />
          <span>{t("documents.label")}:</span>
          {provenance.selected_docs.map((doc) => (
            <span key={doc.path} className="mono">
              {doc.path}
            </span>
          ))}
        </div>
      )}

      <BriefTimeline prId={prId} />
    </div>
  );
}

const COST_SOURCES = new Set(["exact", "estimated", "partial"]);
function isCostSource(v: string | null): v is "exact" | "estimated" | "partial" {
  return v != null && COST_SOURCES.has(v);
}

function CostLine({ provenance }: { provenance: PrBriefRecord["provenance"] }) {
  const t = useTranslations("brief");
  // AC-9/AC-10 trap: `cost_usd` of `0` is a real price and must render as one —
  // every check below is `!= null`, never truthiness.
  if (provenance.cost_usd == null) {
    return <span>{t("cost.unknown")}</span>;
  }
  // `provenance.cost_source` is a loose `string | null` in the brief contract
  // (unlike `RunCostBadge`'s callers, which carry the typed `CostSource`
  // enum) — narrow it rather than casting, so an unrecognised value falls
  // back to no prefix instead of crashing `formatCostUsd`'s lookup.
  const costSource = isCostSource(provenance.cost_source) ? provenance.cost_source : null;
  const costText = formatCostUsd(provenance.cost_usd, costSource);
  return (
    <span>
      <span className="tnum">{costText}</span>
      {provenance.tokens_in != null && provenance.tokens_out != null && (
        <span className="tnum">
          {" · "}
          {t("cost.tokens", { tokensIn: provenance.tokens_in, tokensOut: provenance.tokens_out })}
        </span>
      )}
    </span>
  );
}

function RiskItem({
  risk,
  onGoTo,
}: {
  risk: Risk;
  onGoTo: (file: string, line: number | null) => (() => void) | undefined;
}) {
  const t = useTranslations("brief");
  return (
    <div style={s.riskItem}>
      <div style={s.riskHeader}>
        <span style={s.riskLevelValue(RISK_LEVEL_COLOR[risk.severity])}>{t(`riskLevel.${risk.severity}`)}</span>
        <span style={s.riskTitle}>{risk.title}</span>
      </div>
      <div style={s.riskExplanation}>{risk.explanation}</div>
      {risk.file_refs.length > 0 && (
        <div style={s.riskRefs}>
          {risk.file_refs.map((file, i) => {
            // `Risk.file_refs` carries paths only, no line — opens the file at
            // its first line (AC-46: "the same rules as a review-focus
            // entry", which itself falls back to no-line-shown under AC-25;
            // there is simply no coordinate finer than the file to omit).
            const handler = onGoTo(file, 1);
            return handler ? (
              <button key={i} type="button" style={s.focusFileButton} className="mono" onClick={handler}>
                {file}
              </button>
            ) : (
              <span key={i} style={s.focusFileInert} className="mono">
                {file}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FocusItem({
  index,
  entry,
  onGoTo,
}: {
  index: number;
  entry: ReviewFocusEntry;
  onGoTo: (file: string, line: number | null) => (() => void) | undefined;
}) {
  // AC-25: a `null` line renders WITHOUT a line number — no placeholder text,
  // just the file path. AC-47: with no verified line there is also nothing to
  // navigate to, so the entry is inert (`goTo` returns undefined for a `null`
  // line) rather than a link to an unresolvable destination.
  const location = entry.line != null ? `${entry.file}:${entry.line}` : entry.file;
  const handler = onGoTo(entry.file, entry.line);
  return (
    <div style={s.focusItem}>
      <span style={s.focusIndex}>{index}.</span>
      {handler ? (
        <button type="button" style={s.focusFileButton} className="mono" onClick={handler}>
          {location}
        </button>
      ) : (
        <span style={s.focusFileInert} className="mono">
          {location}
        </span>
      )}
      <span style={s.focusReason}>— {entry.reason}</span>
    </div>
  );
}
