/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, FindingsSeverityRow } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { RunCostBadge } from "@/components/run-cost-badge";
import { toSeverityFindings } from "@/lib/findings-view";
import { useFindingsLabels } from "@/lib/use-findings-labels";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({
  pr,
  repoId,
  repoFullName,
}: {
  pr: PrMeta;
  repoId: string;
  /** owner/repo — deep-links a finding's file:line to GitHub in the hover panel. */
  repoFullName?: string | null;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const findingsLabels = useFindingsLabels();
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  const findingItems = React.useMemo(
    () => toSeverityFindings(pr.findings?.items ?? [], repoFullName, pr.head_sha),
    [pr.findings, repoFullName, pr.head_sha],
  );
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      {/* The row navigates on click, so everything interactive in this cell —
          chips, the hover panel, its file links — must not bubble up to it.
          One guard on the wrapper covers them all. */}
      <div
        style={s.findingsCell}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {pr.findings ? (
          <FindingsSeverityRow
            findings={findingItems}
            counts={pr.findings.counts}
            truncated={pr.findings.truncated}
            align="left"
            labels={findingsLabels}
            emptyPlaceholder={<span style={s.muted}>—</span>}
          />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div title={t("list.costHint")}>
        <RunCostBadge costUsd={pr.cost_usd} costSource={pr.cost_source} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
