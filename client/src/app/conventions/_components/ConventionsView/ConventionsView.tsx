/* ConventionsView — the Conventions page: run a scan, review the grounded
   candidates, accept/reject/edit them, then merge the accepted ones into a
   Skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useBulkSetConventionStatus,
  useConventionSkillDraft,
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useSettings } from "@/lib/hooks";
import { FEATURE_MODELS } from "@/lib/feature-models";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillFromConventionsModal } from "./_components/CreateSkillFromConventionsModal";
import { EditConventionModal } from "./_components/EditConventionModal";
import { SCAN_PROVIDER, ScanModelPicker } from "./_components/ScanModelPicker";
import { countByStatus, relativeTime } from "./helpers";
import { s } from "./styles";

const DEFAULT_MODEL =
  FEATURE_MODELS.find((f) => f.id === "conventions")?.defaultModel ?? "";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const { data: settings } = useSettings();

  const extract = useExtractConventions();
  const update = useUpdateConvention();
  const bulk = useBulkSetConventionStatus();

  const [editing, setEditing] = React.useState<ConventionCandidate | null>(null);
  const [creatingSkill, setCreatingSkill] = React.useState(false);
  const [model, setModel] = React.useState<string | null>(null);

  // The workspace's saved choice seeds the picker; the per-scan selection is
  // local state and is never written back to settings.
  const savedModel = settings?.feature_models?.conventions?.model;
  const effectiveModel = model ?? savedModel ?? DEFAULT_MODEL;
  const isDefaultModel = model === null && !savedModel;

  const draft = useConventionSkillDraft(repoId, { enabled: creatingSkill });

  const repoLabel = activeRepo?.full_name ?? t("page.repoFallback");
  const candidates = data?.candidates ?? [];
  const scan = data?.scan ?? null;
  const { accepted, pending } = countByStatus(candidates);

  const runScan = () => {
    if (!repoId) return;
    extract.mutate({ repoId, provider: SCAN_PROVIDER, model: effectiveModel });
  };

  const setStatus = (id: string, status: ConventionCandidate["status"]) => {
    if (!repoId) return;
    update.mutate({ repoId, id, patch: { status } });
  };

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (!repoId) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="ListChecks" title={t("page.empty.title")} body={t("page.noRepo")} />
        </div>
      </AppShell>
    );
  }

  const ago = scan ? relativeTime(scan.created_at) : null;
  const subtitle = scan
    ? [
        t("page.detectedFrom", { count: scan.sample_count }),
        t("page.lastScan", {
          ago: ago!.key === "justNow" ? t("time.justNow") : t(`time.${ago!.key}`, { count: (ago as { count: number }).count }),
        }),
        t("page.scannedWith", { model: scan.model }),
      ].join(" · ")
    : t("page.subtitle");

  return (
    <AppShell crumb={crumb}>
      {editing && (
        <EditConventionModal
          candidate={editing}
          saving={update.isPending}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            update.mutate(
              { repoId, id: editing.id, patch },
              { onSuccess: () => setEditing(null) },
            );
          }}
        />
      )}

      {creatingSkill && (
        <CreateSkillFromConventionsModal
          draft={draft.data}
          isLoading={draft.isLoading}
          isError={draft.isError}
          repoLabel={repoLabel}
          onClose={() => setCreatingSkill(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.head}>
          <div style={s.headMain}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span style={s.repoName}>{repoLabel}</span>
            </h1>
            <p style={s.subtitle}>{subtitle}</p>
          </div>
          <div style={s.headActions}>
            <ScanModelPicker
              value={effectiveModel}
              onChange={setModel}
              isDefault={isDefaultModel}
            />
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={extract.isPending}
              disabled={extract.isPending}
              onClick={runScan}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          </div>
        </div>

        {isError && <ErrorState body={t("page.loadError")} onRetry={() => void refetch()} />}

        {isLoading && (
          <div style={s.skeletons}>
            <Skeleton height={150} />
            <Skeleton height={150} />
            <Skeleton height={150} />
          </div>
        )}

        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
            ctaLoading={extract.isPending}
          />
        )}

        {!isLoading && !isError && candidates.length > 0 && (
          <>
            <div style={s.bulkBar}>
              {pending > 0 && (
                <>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="Check"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate({ repoId, status: "accepted" })}
                  >
                    {t("bulk.acceptAll", { count: pending })}
                  </Button>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="X"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate({ repoId, status: "rejected" })}
                  >
                    {t("bulk.rejectAll")}
                  </Button>
                </>
              )}
              {accepted > 0 && (
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  loading={creatingSkill && draft.isLoading}
                  style={{ marginLeft: "auto" }}
                  onClick={() => setCreatingSkill(true)}
                >
                  {creatingSkill && draft.isLoading
                    ? t("bulk.buildingDraft")
                    : t("bulk.createSkill")}
                </Button>
              )}
            </div>

            <div style={s.list}>
              {candidates.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  pending={update.isPending || bulk.isPending}
                  repoFullName={activeRepo?.full_name}
                  repoRef={activeRepo?.default_branch}
                  onAccept={(id) => setStatus(id, "accepted")}
                  onReject={(id) => setStatus(id, "rejected")}
                  onUndo={(id) => setStatus(id, "pending")}
                  onEdit={setEditing}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
