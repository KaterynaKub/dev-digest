/* /skills — Skills Lab. Persistent two-column workspace: a scrollable skill
   list on the left, the selected skill's full editor (tabs) on the right.

   Selecting a card never navigates — /skills/[id] still exists as a
   deep-linkable route, but the primary flow keeps the list in place so a user
   can edit several skills in a row without losing scroll position.

   Loading/error/empty states replace the DETAIL column, not the whole page, so
   the header and search stay usable while a refetch is in flight. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Dropdown, EmptyState, ErrorState, Skeleton, Icon, Button } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { SkillDetail } from "./_components/SkillDetail";
import { AddSkillDrawer } from "./_components/AddSkillDrawer";
import { CommunityDrawer } from "./_components/CommunityDrawer";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [community, setCommunity] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const all = skills ?? [];
  const list = filterSkills(all, search);
  // Resolved against the unfiltered set: typing in the search box must not
  // blank the detail pane for a skill the user is in the middle of editing.
  const selected = all.find((sk) => sk.id === selectedId) ?? null;

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {importing && <AddSkillDrawer onClose={() => setImporting(false)} />}
      {community && <CommunityDrawer onClose={() => setCommunity(false)} />}
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}

      <div style={s.page}>
        <div style={s.layout}>
          <div style={s.listCol}>
            <div style={s.listHead}>
              <div style={s.headerRow}>
                <h1 style={s.h1}>{t("page.heading")}</h1>
                <Dropdown
                  width={230}
                  align="right"
                  trigger={
                    <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                      {t("page.addSkill")}
                    </Button>
                  }
                  items={[
                    { label: t("page.menu.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
                    { divider: true },
                    { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
                    { label: t("page.menu.community"), icon: "Globe", onClick: () => setCommunity(true) },
                  ]}
                />
              </div>
              <div style={s.search}>
                <Icon.Search size={13} style={s.searchIcon} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("page.searchPlaceholder")}
                  style={s.searchInput}
                />
              </div>
            </div>

            <div style={s.listScroll}>
              {isLoading && (
                <div style={s.grid}>
                  <Skeleton height={104} />
                  <Skeleton height={104} />
                  <Skeleton height={104} />
                </div>
              )}
              {!isLoading && !isError && list.length > 0 && (
                <div style={s.grid}>
                  {list.map((sk) => (
                    <SkillCard
                      key={sk.id}
                      skill={sk}
                      active={sk.id === selectedId}
                      onClick={() => setSelectedId(sk.id)}
                      onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                    />
                  ))}
                </div>
              )}
              {/* Search that matches nothing is a different situation from an
                  empty library — the latter offers an import CTA, the former
                  would only make the user re-import what they already have. */}
              {!isLoading && !isError && list.length === 0 && all.length > 0 && (
                <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body")} />
              )}
            </div>
          </div>

          <div style={s.detailCol}>
            {isError ? (
              <ErrorState fullScreen body={t("page.loadError")} onRetry={() => refetch()} />
            ) : !isLoading && all.length === 0 ? (
              <EmptyState
                icon="Sparkles"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={t("page.empty.cta")}
                onCta={() => setImporting(true)}
              />
            ) : (
              <SkillDetail skill={selected} />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
