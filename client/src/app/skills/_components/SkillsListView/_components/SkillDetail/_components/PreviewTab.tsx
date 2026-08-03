/* PreviewTab — the skill body rendered the way the reviewing agent receives
   it. Non-manual sources keep the untrusted-source banner here too: the
   rendered view is exactly where a prompt-injection attempt would look most
   like legitimate instructions. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "../styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const untrusted = skill.source !== "manual";

  return (
    <div>
      <div style={s.previewHead}>
        <div style={s.previewTitle}>{t("preview.title")}</div>
        <div style={s.previewSub}>{t("preview.subtitle")}</div>
      </div>
      <div style={s.metaRow}>
        <Badge mono>{t("preview.version", { version: skill.version })}</Badge>
        <Badge color={skill.enabled ? "var(--ok, #22c55e)" : "var(--text-muted)"}>
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
        </Badge>
        {untrusted && (
          <Badge color="var(--warn, #b45309)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
        )}
      </div>
      {untrusted && <div style={s.notice}>{t("preview.untrustedNotice")}</div>}
      <div style={s.previewCard}>
        {skill.body.trim() ? <Markdown>{skill.body}</Markdown> : <span style={s.emptyBody}>{t("preview.empty")}</span>}
      </div>
    </div>
  );
}
