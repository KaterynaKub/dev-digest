/* /skills/:id — deep-linkable single-skill route. The primary flow lives in
   the two-column /skills workspace; this route exists so a skill can be linked
   to directly (from an agent's Skills tab, a bookmark, a toast). It reuses the
   very same <SkillDetail> pane, so the tabs, editor, and version history have
   exactly one implementation. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { SkillDetail } from "../_components/SkillsListView/_components/SkillDetail";

export default function SkillEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;
  const t = useTranslations("skills");

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.loadError")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  if (!isLoading && !skill) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <button
          onClick={() => router.push("/skills")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 13,
            padding: "16px 24px 0",
            textAlign: "left",
          }}
        >
          {t("detail.back")}
        </button>
        {isLoading || !skill ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px" }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={300} />
          </div>
        ) : (
          // key = remount on skill switch, so the form state re-initialises
          // instead of being clobbered by an effect after first paint.
          <SkillDetail key={skill.id} skill={skill} />
        )}
      </div>
    </AppShell>
  );
}
