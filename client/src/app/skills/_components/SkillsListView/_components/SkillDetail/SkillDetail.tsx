/* SkillDetail — the right-hand pane of /skills. Everything about one skill
   lives here behind tabs (Config · Preview · Evals · Stats · Versions) instead
   of on a separate /skills/[id] route, so editing a skill never loses the
   list's selection or scroll position.

   Tab state is local: this is a pane inside a list page, and putting it in the
   URL would make the browser Back button undo a tab switch rather than leave
   the page. Evals and Stats have no backing data yet and render Coming soon. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useToast } from "@/lib/toast";
import { TYPE_COLOR } from "../SkillCard/constants";
import { ComingSoon } from "./_components/ComingSoon";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { SKILL_TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({ skill }: { skill: Skill | null | undefined }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const [tab, setTab] = React.useState("config");

  // Reset to Config when the selected skill changes — a stale "Versions" tab
  // pointed at a different skill is confusing, and this pane is not remounted
  // by the parent (the list keeps it mounted across selections).
  const skillId = skill?.id;
  React.useEffect(() => {
    setTab("config");
  }, [skillId]);

  if (!skill) {
    return (
      <div style={s.empty}>
        <Icon.Sparkles size={22} style={{ color: "var(--text-muted)" }} />
        <div style={s.emptyTitle}>{t("page.selectPrompt.title")}</div>
        <div style={s.emptyBody}>{t("page.selectPrompt.body")}</div>
      </div>
    );
  }

  const tabs = SKILL_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));
  const color = TYPE_COLOR[skill.type] ?? "var(--text-secondary)";

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Icon.Sparkles size={15} style={s.titleIcon} />
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge mono icon="History">
          {t("preview.version", { version: skill.version })}
        </Badge>
        <span style={s.headerSpacer} />
        {/* No eval runner exists yet — the affordance is shown (it is the
            centre of the intended workflow) but says so on click. */}
        <Button size="sm" icon="Play" onClick={() => toast.info(t("evals.comingSoon.title"))}>
          {t("detail.runOnEvals")}
        </Button>
      </div>

      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0 24px" />
      </div>

      <div style={s.body}>
        {/* key = remount per skill so each tab's form state re-initialises
            from the new skill instead of being reset by an effect after
            first paint (the idiom ConfigTab documents for agents). */}
        {tab === "config" && <ConfigTab key={skill.id} skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && (
          <ComingSoon icon="ListChecks" title={t("evals.comingSoon.title")} body={t("evals.comingSoon.body")} />
        )}
        {tab === "stats" && (
          <ComingSoon icon="BarChart" title={t("stats.comingSoon.title")} body={t("stats.comingSoon.body")} />
        )}
        {tab === "versions" && <VersionsTab key={skill.id} skill={skill} />}
      </div>
    </div>
  );
}
