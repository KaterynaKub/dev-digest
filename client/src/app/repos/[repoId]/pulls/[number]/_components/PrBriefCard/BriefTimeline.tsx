/* BriefTimeline — "how the intent changed" history for a PR's briefs, one row
   per retained generation (0003 — Why Timeline). Renders under the current
   brief inside PrBriefCard; a separate sub-component because the current
   brief and its history have different loading/empty rules (a single entry
   duplicates what is already shown above and renders nothing here). */
"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { useBriefTimeline } from "@/lib/hooks/reviews";
import { RISK_LEVEL_COLOR } from "./constants";
import { s } from "./styles";

export function BriefTimeline({ prId }: { prId: string | null }) {
  const t = useTranslations("brief");
  const { data, isLoading } = useBriefTimeline(prId);

  if (isLoading) {
    return (
      <div style={s.timelineWrap}>
        <div style={s.timelineHeading}>{t("timeline.title")}</div>
        <div style={s.loadingLine} role="status" aria-live="polite">
          <span>{t("timeline.loading")}</span>
        </div>
        <Skeleton height={14} width="60%" />
      </div>
    );
  }

  const entries = data?.entries ?? [];
  // One entry is just the brief already rendered above — the timeline earns
  // its place only once there is a second point to compare it against.
  if (entries.length < 2) return null;

  return (
    <div style={s.timelineWrap}>
      <div style={s.timelineHeading}>{t("timeline.title")}</div>
      <div style={s.timelineList}>
        {entries.map((entry) => (
          <div key={`${entry.head_sha}-${entry.indexed_sha ?? ""}`} style={s.timelineItem}>
            <div style={s.timelineMetaRow}>
              <span className="mono">{entry.head_sha.slice(0, 7)}</span>
              <span>{new Date(entry.generated_at).toLocaleString()}</span>
              <span style={s.riskLevelValue(RISK_LEVEL_COLOR[entry.risk_level])}>
                {t(`riskLevel.${entry.risk_level}`)}
              </span>
              {entry.is_current ? (
                <span style={s.timelineBadgeCurrent}>{t("timeline.current")}</span>
              ) : (
                <span style={s.timelineBadgeStale}>{t("timeline.stale")}</span>
              )}
            </div>
            <div style={s.timelineWhat}>{entry.what}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
