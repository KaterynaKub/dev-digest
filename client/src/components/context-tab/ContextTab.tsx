/* ContextTab — attach/detach and order the Project Context documents an
   agent or a skill uses (AC-7…AC-14, AC-37, AC-52, AC-64/65/68). Shared
   between the agent editor (`app/agents/[id]`) and the skill detail pane
   (`app/skills`) via the `entity` prop, so it lives in `components/` rather
   than under either route's `_components/` — the repo's own lint config
   (`no-restricted-imports`, `@/app/*`) forbids importing route code from a
   different route, same as `diff-viewer` and `run-cost-badge` already do for
   the same reason. Each route keeps a thin `_components/ContextTab/index.ts`
   re-export so call sites read like every other tab; there is exactly one
   implementation, here.

   Copies `SkillsTab`'s form almost exactly (see its own doc comment): one
   list, attached docs first in persisted order, then the rest; checkbox is
   the attach control; native HTML5 drag reorders, with ▲/▼ as the keyboard
   path (NFR-13) since a drag handle alone is unreachable without a pointer.
   The difference from SkillsTab is what a row carries — a type badge derived
   from the matched root (AC-64/65/68) and a Preview action — and that
   attaching is capped at 20 (AC-12), which SkillsTab's linked-skill set has
   no equivalent limit for.

   `repoId` is resolved from the active repo (this tab is not itself
   repo-scoped — AgentEditor/SkillDetail live outside any `/repos/:repoId`
   route) and is OPTIONAL end-to-end: absent, `missing` always reads `false`
   from the server (AttachmentsQuery), which is an acceptable degrade for a
   user with no repo selected yet, not a broken state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Icon, Markdown, Skeleton } from "@devdigest/ui";
import {
  useAgentContextDocs,
  useSetAgentContextDocs,
  useSkillContextDocs,
  useSetSkillContextDocs,
  useContextDoc,
  useContextDocs,
  useContextDocsSum,
} from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import {
  MAX_ATTACHED_DOCS,
  NEUTRAL_TYPE_BG,
  NEUTRAL_TYPE_COLOR,
  ROOT_TYPE_BG,
  ROOT_TYPE_COLOR,
  ROW_ICON_SIZE,
  rootTypeLabel,
} from "./constants";
import { s } from "./styles";

export function ContextTab({ entity, id, repoId: repoIdProp }: { entity: "agent" | "skill"; id: string; repoId?: string }) {
  const t = useTranslations("context");
  const toast = useToast();
  const { repoId: activeRepoId } = useActiveRepo();
  const repoId = repoIdProp ?? activeRepoId ?? undefined;

  const agentAttach = useAgentContextDocs(entity === "agent" ? id : null, repoId);
  const skillAttach = useSkillContextDocs(entity === "skill" ? id : null, repoId);
  const attachments = entity === "agent" ? agentAttach.data : skillAttach.data;

  const setAgentDocs = useSetAgentContextDocs();
  const setSkillDocs = useSetSkillContextDocs();

  const { data: listing } = useContextDocs(repoId);
  // `listing?.docs ?? []` allocates a new array reference every render, which
  // would otherwise retrigger every memo below that depends on `allDocs` on
  // each render — wrapped in its own memo, keyed on the actual query data.
  const allDocs = React.useMemo(() => listing?.docs ?? [], [listing]);

  // Seeded once from the loaded attachments; `null` while attachments haven't
  // arrived yet keeps the initial render from flashing every row unattached.
  const [attachedPaths, setAttachedPaths] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (attachments && attachedPaths === null) {
      setAttachedPaths([...attachments].sort((a, b) => a.order - b.order).map((a) => a.path));
    }
  }, [attachments, attachedPaths]);

  const [filter, setFilter] = React.useState("");
  const [draggingPath, setDraggingPath] = React.useState<string | null>(null);
  const [dropBeforePath, setDropBeforePath] = React.useState<string | null>(null);
  const [hoverPath, setHoverPath] = React.useState<string | null>(null);
  const [focusPath, setFocusPath] = React.useState<string | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const paths = React.useMemo(() => attachedPaths ?? [], [attachedPaths]);
  const missingByPath = React.useMemo(
    () => new Map((attachments ?? []).map((a) => [a.path, a.missing])),
    [attachments],
  );
  const rootByPath = React.useMemo(() => new Map(allDocs.map((d) => [d.path, d.root])), [allDocs]);

  // Attached first (persisted order, AC-52), then the rest. A path attached
  // but no longer discovered (deleted from the clone) still renders as a
  // "missing" row (AC-37) — it is synthesised into the list rather than
  // dropped, since it isn't present in `allDocs` either.
  const ordered = React.useMemo(() => {
    const attachedRows = paths.map((p) => ({ path: p, root: rootByPath.get(p) ?? null }));
    const rest = allDocs.filter((d) => !paths.includes(d.path)).map((d) => ({ path: d.path, root: d.root }));
    return [...attachedRows, ...rest];
  }, [paths, allDocs, rootByPath]);

  const needle = filter.trim().toLowerCase();
  const visible = needle ? ordered.filter((r) => r.path.toLowerCase().includes(needle)) : ordered;

  const sum = useContextDocsSum(repoId, paths);

  const commit = (next: string[]) => {
    setAttachedPaths(next);
    if (entity === "agent") {
      setAgentDocs.mutate({ agentId: id, paths: next });
    } else {
      setSkillDocs.mutate({ skillId: id, paths: next });
    }
  };

  const toggle = (path: string) => {
    if (!paths.includes(path) && paths.length >= MAX_ATTACHED_DOCS) {
      toast.error(t("tab.limitReached", { max: MAX_ATTACHED_DOCS }));
      return;
    }
    commit(paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path]);
  };

  const move = (path: string, dir: -1 | 1) => {
    const i = paths.indexOf(path);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= paths.length) return;
    const next = [...paths];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    commit(next);
  };

  const drop = (targetPath: string | null) => {
    const dragged = draggingPath;
    setDraggingPath(null);
    setDropBeforePath(null);
    if (!dragged || !paths.includes(dragged) || dragged === targetPath) return;
    const without = paths.filter((p) => p !== dragged);
    const at = targetPath ? without.indexOf(targetPath) : -1;
    const next = at < 0 ? [...without, dragged] : [...without.slice(0, at), dragged, ...without.slice(at)];
    commit(next);
  };

  const saving = setAgentDocs.isPending || setSkillDocs.isPending;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("tab.attachedCount", { linked: paths.length, total: allDocs.length })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={ROW_ICON_SIZE} style={s.searchIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tab.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.hint}>{entity === "agent" ? t("tab.orderHintAgent") : t("tab.orderHintSkill")}</div>

      {visible.length === 0 && <div style={s.empty}>{t("tab.noneAvailable")}</div>}

      <div style={s.list} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(null)}>
        {visible.map((row) => {
          const linked = paths.includes(row.path);
          const i = paths.indexOf(row.path);
          const missing = missingByPath.get(row.path) === true;
          const typeLabel = rootTypeLabel(row.root);
          const color = typeLabel ? (ROOT_TYPE_COLOR[typeLabel] ?? NEUTRAL_TYPE_COLOR) : NEUTRAL_TYPE_COLOR;
          const bg = typeLabel ? (ROOT_TYPE_BG[typeLabel] ?? NEUTRAL_TYPE_BG) : NEUTRAL_TYPE_BG;
          return (
            <div
              key={row.path}
              draggable={linked}
              onDragStart={() => setDraggingPath(row.path)}
              onDragEnd={() => {
                setDraggingPath(null);
                setDropBeforePath(null);
              }}
              onDragOver={(e) => {
                if (!draggingPath || !linked) return;
                e.preventDefault();
                setDropBeforePath(row.path);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                drop(row.path);
              }}
              onMouseEnter={() => setHoverPath(row.path)}
              onMouseLeave={() => setHoverPath((cur) => (cur === row.path ? null : cur))}
              onFocus={() => setFocusPath(row.path)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setFocusPath((cur) => (cur === row.path ? null : cur));
                }
              }}
              style={s.row(linked, draggingPath === row.path, dropBeforePath === row.path)}
            >
              <span style={s.handle} aria-hidden="true">
                <Icon.Menu size={ROW_ICON_SIZE} />
              </span>
              <button
                type="button"
                role="checkbox"
                aria-checked={linked}
                aria-label={row.path}
                onClick={() => toggle(row.path)}
                style={s.checkbox(linked)}
              >
                {linked && <Icon.Check size={10} style={{ color: "#fff" }} />}
              </button>
              <span className="mono" style={s.rowPath(linked)}>
                {row.path}
              </span>
              {missing && <span style={s.missingTag}>{t("tab.missing")}</span>}
              {linked && (
                <div style={s.reorderOverlay(hoverPath === row.path || focusPath === row.path)}>
                  <button
                    type="button"
                    aria-label={t("tab.moveUp", { path: row.path })}
                    disabled={i === 0}
                    onClick={() => move(row.path, -1)}
                    style={s.reorderBtn(i === 0)}
                  >
                    <Icon.ArrowUp size={ROW_ICON_SIZE} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("tab.moveDown", { path: row.path })}
                    disabled={i === paths.length - 1}
                    onClick={() => move(row.path, 1)}
                    style={s.reorderBtn(i === paths.length - 1)}
                  >
                    <Icon.ArrowDown size={ROW_ICON_SIZE} />
                  </button>
                </div>
              )}
              {typeLabel && (
                <span style={s.typeBadge}>
                  <Badge color={color} bg={bg}>
                    {typeLabel}
                  </Badge>
                </span>
              )}
              <Button
                size="sm"
                kind="ghost"
                icon="Eye"
                style={s.previewBtn}
                onClick={() => setPreviewPath(row.path)}
              >
                {t("tab.preview")}
              </Button>
            </div>
          );
        })}
      </div>

      <div style={s.footer}>
        <span style={s.footerTokens}>
          {sum.pending ? t("tab.tokensLoading") : t("tab.tokensSum", { count: sum.tokens, marker: sum.approximate ? "≈" : "" })}
        </span>
        <span style={s.footerHint}>{t(entity === "agent" ? "tab.injectedHintAgent" : "tab.injectedHintSkill")}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, height: 16 }}>
        {saving ? t("tab.saving") : ""}
      </div>

      {previewPath && (
        <ContextDocPreview repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}

/** Read-only preview drawer for one document — reuses the same `useContextDoc`
    hook the Project Context page's own preview mode uses, so both surfaces
    stay in lockstep on what "the current content" means. */
function ContextDocPreview({
  repoId,
  path,
  onClose,
}: {
  repoId: string | undefined;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useContextDoc(repoId, path);
  return (
    <Drawer title={path} onClose={onClose}>
      {isLoading && (
        <div role="status" aria-label={t("tab.previewLoading")}>
          <Skeleton height={16} />
          <Skeleton height={16} style={{ marginTop: 8 }} />
          <Skeleton height={16} style={{ marginTop: 8, width: "70%" }} />
        </div>
      )}
      {isError && <div style={{ color: "var(--crit)", fontSize: 13 }}>{t("tab.previewError")}</div>}
      {!isLoading && !isError && <Markdown>{data?.content}</Markdown>}
    </Drawer>
  );
}
