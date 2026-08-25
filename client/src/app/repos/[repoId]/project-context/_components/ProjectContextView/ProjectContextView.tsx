/* ProjectContextView — /repos/:repoId/project-context (AC-1…AC-6, AC-13…67
   scoped to the UI half). Two-column persistent layout: document list left
   (with the status line pinned under it), preview/edit right — same nested
   overflow shape as `SkillsListView`.

   The status line is assembled HERE from the server's `ContextStatus`
   structure, never from a pre-formatted string (the server does not format
   one) — see the six branches in `StatusLine` below, each keyed to its own
   `context.json` string so no branch's copy is hard-coded in JSX.

   Three distinct "nothing to show" states are never collapsed into one:
   roots matched no file (AC-5, names the searched roots), repo has no local
   clone (AC-6/AC-63, omits count/sum rather than showing zero), and the
   clone exists but could not be READ right now (NFR-7, a fetch error — never
   rendered as an empty list, which would misreport a real failure as
   "nothing here"). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Markdown, Skeleton, Textarea } from "@devdigest/ui";
import type { ContextDoc, ContextStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextDoc, useContextDocs, useSaveContextDoc } from "@/lib/hooks/project-context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { NEUTRAL_TYPE_BG, NEUTRAL_TYPE_COLOR, ROOT_TYPE_BG, ROOT_TYPE_COLOR, rootTypeLabel } from "./constants";
import { relativeTime } from "./helpers";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;

  const { data: listing, isLoading, isError, refetch } = useContextDocs(repoId);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  // `listing?.docs ?? []` allocates a new array reference every render, which
  // would otherwise retrigger the auto-select effect below on each render —
  // wrapped in its own memo, keyed on the actual query data (same fix as
  // `components/context-tab/ContextTab.tsx`'s `allDocs`).
  const docs = React.useMemo(() => listing?.docs ?? [], [listing]);
  React.useEffect(() => {
    if (!selectedPath && docs.length > 0) setSelectedPath(docs[0]!.path);
  }, [docs, selectedPath]);
  const selected = docs.find((d) => d.path === selectedPath) ?? null;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("tab.title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("tab.title") }]}>
      <div style={s.page}>
        <div style={s.layout}>
          <div style={s.listCol}>
            <div style={s.listHead}>
              <span style={s.listLabel}>{t("tab.title")}</span>
            </div>

            <div style={s.listScroll}>
              {isLoading && (
                <>
                  <Skeleton height={30} style={{ marginBottom: 6 }} />
                  <Skeleton height={30} style={{ marginBottom: 6 }} />
                  <Skeleton height={30} />
                </>
              )}
              {!isLoading &&
                !isError &&
                docs.map((doc) => (
                  <DocRow key={doc.path} doc={doc} active={doc.path === selectedPath} onClick={() => setSelectedPath(doc.path)} />
                ))}
            </div>

            {listing?.status && <StatusLine status={listing.status} />}
          </div>

          <div style={s.detailCol}>
            {isError ? (
              <ErrorState fullScreen body={t("loadError")} onRetry={() => refetch()} />
            ) : !isLoading && listing?.status.cloned === false ? (
              // AC-6/AC-63 — no local clone. A distinct state, never an empty list.
              <EmptyState icon="GitBranch" title={t("notCloned.title")} body={t("notCloned.body")} />
            ) : !isLoading && docs.length === 0 ? (
              // AC-5 — roots matched nothing; names the roots that were searched.
              <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body", { roots: DEFAULT_ROOTS_HINT })} />
            ) : selected ? (
              <DocDetail repoId={repoId} doc={selected} />
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** Roots are not returned by the listing when it's empty (nothing matched to
    derive them from) — the configured set is stable app-wide, so the empty
    body names the DEFAULT roots (mirrors server `DEFAULT_CONTEXT_ROOTS`,
    inlined per the no-runtime-import-of-server-constants convention) rather
    than guessing from zero rows. A workspace running a custom root set still
    sees an honest (if generic) hint instead of a wrong specific one. */
const DEFAULT_ROOTS_HINT = "specs/, docs/, insights/";

function DocRow({ doc, active, onClick }: { doc: ContextDoc; active: boolean; onClick: () => void }) {
  const typeLabel = rootTypeLabel(doc.root);
  const color = typeLabel ? (ROOT_TYPE_COLOR[typeLabel] ?? NEUTRAL_TYPE_COLOR) : NEUTRAL_TYPE_COLOR;
  const bg = typeLabel ? (ROOT_TYPE_BG[typeLabel] ?? NEUTRAL_TYPE_BG) : NEUTRAL_TYPE_BG;
  return (
    <button type="button" style={s.docRow(active)} onClick={onClick}>
      <Icon.FileText size={13} style={{ color: active ? "var(--text-primary)" : "var(--text-muted)", flexShrink: 0 }} />
      <span className="mono" style={s.docRowPath(active)}>
        {doc.path}
      </span>
      {typeLabel && (
        <Badge color={color} bg={bg}>
          {typeLabel}
        </Badge>
      )}
    </button>
  );
}

/**
 * Six status-line states, each keyed to its own `context.json` string:
 *   1. not cloned (AC-6/AC-63) — handled by the caller before this renders.
 *   2. sum pending (AC-61) — pending indicator IN PLACE OF the sum; the list
 *      itself is never blocked on it.
 *   3. empty listing (AC-62) — explicit "0 tokens", not an omission.
 *   4. normal — count · ≈tokens · scanned time.
 *   5+6. fallback-used (AC-60) / truncated (NFR-19/NFR-22) — appended notes,
 *      independent of and combinable with any of the above.
 */
function StatusLine({ status }: { status: ContextStatus }) {
  const t = useTranslations("context");
  if (!status.cloned) {
    return (
      <div style={s.statusLine}>
        <div style={s.statusMain}>
          <span style={s.statusDot("var(--text-muted)")} />
          {t("status.notCloned")}
        </div>
      </div>
    );
  }

  const count = status.count ?? 0;
  const main = status.token_sum_pending
    ? t("status.pending", { count })
    : count === 0
      ? t("status.emptySum", { count })
      : t("status.summary", { count, tokens: status.token_sum ?? 0 });

  return (
    <div style={s.statusLine}>
      <div style={s.statusMain}>
        <span style={s.statusDot("var(--ok)")} />
        {main}
        <span style={{ color: "var(--text-muted)" }}>· {relativeTime(status.scanned_at)}</span>
      </div>
      {status.fallback_used && <div style={s.statusNote}>{t("status.fallbackUsed")}</div>}
      {status.truncated && <div style={s.statusNote}>{t("status.truncated")}</div>}
    </div>
  );
}

function DocDetail({ repoId, doc }: { repoId: string; doc: ContextDoc }) {
  const t = useTranslations("context");
  const toast = useToast();
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const { data, isLoading, isError } = useContextDoc(repoId, doc.path);
  const save = useSaveContextDoc(repoId);

  const [draft, setDraft] = React.useState<string | null>(null);
  React.useEffect(() => {
    // Reset the draft whenever a different document is selected or the
    // server content changes underneath (e.g. after a successful save) — the
    // effect only fires on a real content change, not on every render.
    setDraft(null);
  }, [doc.path]);

  const content = data?.content ?? "";
  const draftValue = draft ?? content;
  const dirty = mode === "edit" && draft !== null && draft !== content;

  const onSave = () => {
    if (draft === null) return;
    save.mutate(
      { path: doc.path, content: draft },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(t("editor.savedToast"));
            setDraft(null);
            setMode("preview");
          }
        },
      },
    );
  };

  return (
    <>
      <div style={s.detailHead}>
        <span className="mono" style={s.detailPath}>
          {doc.path}
        </span>
        <Badge color="var(--text-secondary)">{t("usedByAgents", { count: doc.attached_count })}</Badge>
        <div style={s.detailHeadSpacer} />
        <Button kind="tertiary" size="sm" active={mode === "preview"} onClick={() => setMode("preview")}>
          {t("mode.preview")}
        </Button>
        <Button kind="tertiary" size="sm" active={mode === "edit"} onClick={() => setMode("edit")}>
          {t("mode.edit")}
        </Button>
      </div>

      <div style={s.detailScroll}>
        {isLoading && (
          <div role="status" aria-label={t("editor.loading")}>
            <Skeleton height={16} />
            <Skeleton height={16} style={{ marginTop: 8 }} />
            <Skeleton height={16} style={{ marginTop: 8, width: "70%" }} />
          </div>
        )}
        {isError && <div style={s.saveError}>{t("editor.loadError")}</div>}
        {!isLoading && !isError && (
          <>
            {data?.dirty && (
              <div style={s.uncommittedNote}>
                <Icon.AlertTriangle size={13} />
                {t("editor.uncommitted")}
              </div>
            )}
            {mode === "preview" ? (
              <Markdown>{content}</Markdown>
            ) : (
              <Textarea value={draftValue} onChange={setDraft} rows={22} mono />
            )}
          </>
        )}
      </div>

      {mode === "edit" && !isLoading && !isError && (
        <div style={s.editActions}>
          <Button kind="primary" icon="Check" loading={save.isPending} disabled={!dirty} onClick={onSave}>
            {save.isPending ? t("editor.saving") : t("editor.save")}
          </Button>
          {save.isError && <span style={s.saveError}>{t("editor.saveFailed")}</span>}
        </div>
      )}
    </>
  );
}
