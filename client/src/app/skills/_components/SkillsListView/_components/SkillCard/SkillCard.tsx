/* SkillCard — leading type icon, name, enabled toggle, description, type +
   provenance line, and a stats strip. Mirrors AgentCard's click/toggle split:
   the card click selects the skill for the detail pane, the Toggle has its own
   stopPropagation wrapper so it doesn't also select.

   The stats strip (agents using / pull / accept) has no backing telemetry yet,
   so it renders a "coming soon" placeholder rather than fabricated numbers. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SOURCE_ICON, TYPE_COLOR } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const needsVetting = skill.source !== "manual";
  const color = TYPE_COLOR[skill.type] ?? "var(--text-secondary)";
  const SourceIcon = Icon[SOURCE_ICON[skill.source] ?? "File"];

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.main}>
        <div style={s.headerRow}>
          <Icon.Sparkles size={14} style={s.icon(color)} />
          <span className="mono" style={s.name}>
            {skill.name}
          </span>
          {onToggle && (
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle on={skill.enabled} onChange={onToggle} size={14} />
            </div>
          )}
        </div>
        <div style={s.description}>{skill.description}</div>
        <div style={s.metaRow}>
          <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
          <span style={s.sourceRow}>
            <SourceIcon size={11} />
            {t(`listItem.source.${skill.source}`)}
          </span>
          {needsVetting && (
            <span title={t("listItem.vettingTitle")}>
              <Badge color="var(--warn, #b45309)" icon="AlertTriangle">
                {t("listItem.needsVetting")}
              </Badge>
            </span>
          )}
        </div>
      </div>
      <div style={s.stats}>
        <span style={s.statSoon}>{t("comingSoon")}</span>
      </div>
    </div>
  );
}
