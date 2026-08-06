"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import { useIntent, useDeriveIntent } from "@/lib/hooks/reviews";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { s } from "./styles";

export interface IntentCardProps {
  prId: string | null;
}

/**
 * INTENT card — the derived PR intent/scope, shown above review results
 * (FindingsTab). All data comes from useIntent/useDeriveIntent (never a raw
 * fetch here); every state below is required (loading skeleton, re-deriving
 * button, empty, error, low-confidence caveat, missing-context list).
 */
export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError, refetch } = useIntent(prId);
  const deriveIntent = useDeriveIntent(prId);

  const intent = data?.intent ?? null;

  const handleRederive = () => {
    deriveIntent.mutate();
  };

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.loadingLine} role="status" aria-live="polite">
          <Icon.RefreshCw size={14} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span>{t("intent.loading")}</span>
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
          <span>{t("intent.error")}</span>
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {t("intent.rederive")}
          </Button>
        </div>
      </div>
    );
  }

  if (!intent) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="Sparkles"
          title={t("intent.title")}
          body={
            <>
              {t("intent.empty")}
              <br />
              {t("intent.emptyCta")}
            </>
          }
          cta={t("intent.rederive")}
          onCta={handleRederive}
          ctaLoading={deriveIntent.isPending}
        />
      </div>
    );
  }

  const lowConfidence = intent.confidence != null && intent.confidence <= LOW_CONFIDENCE_THRESHOLD;
  const missingContext = intent.missing_context ?? [];
  const hasAllowlistNote = missingContext.some((m) => m.toLowerCase().includes("allowlist"));

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)" }}>
          {t("intent.title")}
        </span>
        <Button
          kind="ghost"
          size="sm"
          icon="RefreshCw"
          loading={deriveIntent.isPending}
          onClick={handleRederive}
        >
          {deriveIntent.isPending ? t("intent.rederiving") : t("intent.rederive")}
        </Button>
      </div>

      <div style={s.summary}>&ldquo;{intent.intent}&rdquo;</div>

      <div style={s.columns}>
        <div>
          <div style={s.columnHeading}>{t("intent.inScope")}</div>
          <ul style={s.list}>
            {intent.in_scope.map((item, i) => (
              <li key={i} style={s.listItem}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div style={s.columnHeading}>{t("intent.outOfScope")}</div>
          <ul style={s.list}>
            {intent.out_of_scope.map((item, i) => (
              <li key={i} style={s.listItem}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {lowConfidence && (
        <div style={s.caveat}>
          {t("intent.confidence", { pct: Math.round((intent.confidence ?? 0) * 100) })}
          {" — "}
          {t("intent.lowConfidence")}
        </div>
      )}

      {missingContext.length > 0 && (
        <div style={s.missingContext}>
          <div style={s.missingContextHeading}>{t("intent.missingContext")}</div>
          <ul style={s.list}>
            {missingContext.map((note, i) => (
              <li key={i} style={s.missingContextItem}>
                {note}
              </li>
            ))}
          </ul>
          {hasAllowlistNote && (
            <div style={s.missingContextHint}>
              <Link href="/settings/models" style={{ color: "var(--accent-text)" }}>
                {t("intent.missingContextLinkHint")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
