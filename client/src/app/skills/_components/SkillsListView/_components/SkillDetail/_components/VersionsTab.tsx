/* VersionsTab — immutable body snapshots, newest first.

   Restore is a forward operation, not a rewind: there is no restore endpoint,
   so it PUTs the old body back through the normal update path, which snapshots
   a NEW version. History therefore stays append-only and an eval run scored
   against v3 keeps pointing at the exact text it scored.

   Diff has no viewer yet (the repo's DiffViewer is built for file patches, not
   two markdown blobs), so the button reports Coming soon rather than opening
   an empty panel. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { s } from "../styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();

  if (isLoading) {
    return (
      <div style={s.versionList}>
        <Skeleton height={62} />
        <Skeleton height={62} />
        <Skeleton height={62} />
      </div>
    );
  }
  if (isError) return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;

  const list = [...(versions ?? [])].sort((a, b) => b.version - a.version);

  if (list.length === 0) {
    return <EmptyState icon="History" title={t("versions.empty.title")} body={t("versions.empty.body")} />;
  }

  const restore = (version: number, body: string) =>
    update.mutate(
      { id: skill.id, patch: { body } },
      { onSuccess: (data) => toast.success(t("versions.restored", { version, newVersion: data.version })) },
    );

  return (
    <div>
      <div style={s.versionsHead}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-muted)">{t("versions.count", { count: list.length })}</Badge>
      </div>
      <div style={s.versionsSub}>{t("versions.subtitle")}</div>
      <div style={s.versionList}>
        {list.map((v) => {
          const current = v.version === skill.version;
          return (
            <div key={v.version} style={s.versionRow}>
              <Badge mono style={s.versionChip}>
                {t("preview.version", { version: v.version })}
              </Badge>
              <div style={s.versionMain}>
                <div style={s.versionLabel}>{t("preview.version", { version: v.version })}</div>
                <div className="tnum" style={s.versionDate}>
                  {new Date(v.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={s.versionActions}>
                {current ? (
                  <Badge color="var(--ok, #22c55e)" dot>
                    {t("versions.current")}
                  </Badge>
                ) : (
                  <>
                    <Button size="sm" icon="Eye" onClick={() => toast.info(t("versions.diffSoon"))}>
                      {t("versions.diff")}
                    </Button>
                    <Button
                      size="sm"
                      icon="History"
                      disabled={update.isPending}
                      onClick={() => restore(v.version, v.body)}
                    >
                      {update.isPending ? t("versions.restoring") : t("versions.restore")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
