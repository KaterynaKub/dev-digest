/* SmartDiffSection — "REVIEWER-ORDERED DIFF": groups the PR's files into
   core/wiring/boilerplate (server-derived, deterministic, no model call) and
   overlays per-line severity marks from past reviews. A Smart/Original order
   toggle lets the reviewer flip back to the plain file list (DiffTab keeps the
   original DiffViewer path — this section never replaces it, only adds one
   above it).

   Deliberate omissions (do not "restore" on a future read):
   - `pseudocode_summary` is never rendered (no "What this does" block, no
     "summary" badge) even though the contract carries the field — out of
     scope for this pass, see spec 0005b.
   - Navigating from a mark to its finding's card (spec 0005c) wraps the badge
     in a button ONLY when `onGoToFinding` is supplied, so this component stays
     renderable without a navigation host.

   Reuse note: `parsePatch`/`type Line` and `lineRowFor`/`lineSignFor` are
   imported directly from `@/components/diff-viewer/helpers` and
   `@/components/diff-viewer/styles` — deep imports past that module's barrel
   (which exports only `DiffViewer` and `DiffCommentApi`). Deliberate: widening
   a shared component's public surface for one consumer is worse than a
   documented deep import. `lineNo`/`lineText` styles are copied rather than
   imported since they are plain objects, keeping the shared module's exported
   surface unchanged. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { parsePatch, type Line } from "@/components/diff-viewer/helpers";
import { lineRowFor, lineSignFor } from "@/components/diff-viewer/styles";
import { useSmartDiff } from "@/lib/hooks/reviews";
import type { PrFile, SmartDiffFile, SmartDiffFindingMark, SmartDiffRole, Severity } from "@devdigest/shared";
import { GROUP_DEFAULT_OPEN, GROUP_ORDER, ROLE_COLOR, SEVERITY_BG, SEVERITY_COLOR } from "./constants";
import { chevronFor, s } from "./styles";

export interface SmartDiffSectionProps {
  prId: string | null;
  files: PrFile[];
  order: "smart" | "original";
  onOrderChange: (order: "smart" | "original") => void;
  /** Navigates to a finding's card in the Findings tab. When omitted, mark
   *  badges render as plain non-interactive badges (see header comment). */
  onGoToFinding?: (findingId: string) => void;
}

const GROUP_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  wiring: "smartDiff.wiringLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};

const GROUP_CAPTION_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreCaption",
  wiring: "smartDiff.wiringCaption",
  boilerplate: "smartDiff.boilerplateCaption",
};

export function SmartDiffSection({ prId, files, order, onOrderChange, onGoToFinding }: SmartDiffSectionProps) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError } = useSmartDiff(prId);

  // Group-level expansion is computed once, in the useState initialiser —
  // never synced later in an effect. (File-level expansion is likewise a
  // useState initialiser, one level down in SmartDiffFileCard — each file
  // card mounts only once its group is open and `data` is already in hand,
  // so its own initialiser sees the real finding_count from the first render.)
  const [openGroups, setOpenGroups] = React.useState<Record<SmartDiffRole, boolean>>(
    () => ({ ...GROUP_DEFAULT_OPEN }),
  );

  const filesByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const f of files) map.set(f.path, f);
    return map;
  }, [files]);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const toggleGroup = (role: SmartDiffRole) => setOpenGroups((prev) => ({ ...prev, [role]: !prev[role] }));

  const groupsByRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const group of data?.groups ?? []) groupsByRole.set(group.role, group.files);

  return (
    <section style={s.section}>
      <SectionLabel icon="Code">{t("smartDiff.title")}</SectionLabel>

      <div style={s.statsRow}>
        <span style={s.stats} className="mono tnum">
          {t.rich("smartDiff.stats", {
            files: files.length,
            additions: totalAdditions,
            deletions: totalDeletions,
            add: (chunks) => <span style={s.addText}>{chunks}</span>,
            del: (chunks) => <span style={s.delText}>{chunks}</span>,
          })}
        </span>
        <div style={s.toggleWrap} role="group">
          <button
            type="button"
            style={s.toggleButton(order === "smart")}
            aria-pressed={order === "smart"}
            onClick={() => onOrderChange("smart")}
          >
            {t("smartDiff.smartOrder")}
          </button>
          <button
            type="button"
            style={s.toggleButton(order === "original")}
            aria-pressed={order === "original"}
            onClick={() => onOrderChange("original")}
          >
            {t("smartDiff.originalOrder")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div>
          <div role="status" aria-live="polite" style={{ marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }}>
            {t("smartDiff.loading")}
          </div>
          <Skeleton height={80} />
        </div>
      )}

      {isError && <div style={{ fontSize: 13, color: "var(--crit)", marginBottom: 12 }}>{t("smartDiff.error")}</div>}

      {!isLoading && !isError && data && (
        <>
          {data.split_suggestion.too_big && (
            <div style={s.splitCallout}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {t("smartDiff.largeTitle", { lines: data.split_suggestion.total_lines })}
              </div>
              <div style={{ marginBottom: 8 }}>{t("smartDiff.largeBody")}</div>
              {/* PR-level callout (too_big counts reviewable lines across the whole
                  PR) — unrelated to the per-file is_large badge below (one file's
                  churn). Keep them separate; they will otherwise be "unified" later. */}
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.split_suggestion.proposed_splits.map((split) => (
                  <li key={split.name}>
                    {split.name} — {t("smartDiff.filesCount", { count: split.files.length })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {files.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("smartDiff.empty")}</div>}

          {files.length > 0 &&
            GROUP_ORDER.map((role) => {
              const groupFiles = groupsByRole.get(role) ?? [];
              const open = openGroups[role];
              return (
                <div key={role}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    style={s.groupHeader}
                    onClick={() => toggleGroup(role)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") toggleGroup(role);
                    }}
                  >
                    <Icon.ChevronRight size={13} style={chevronFor(open)} />
                    <span style={s.groupChip(ROLE_COLOR[role])} />
                    <span style={s.groupName}>{t(GROUP_LABEL_KEY[role])}</span>
                    <span style={s.groupCaption}>{t(GROUP_CAPTION_KEY[role])}</span>
                    <span style={s.groupCount} className="tnum">
                      {t("smartDiff.filesCount", { count: groupFiles.length })}
                    </span>
                  </div>

                  {open && groupFiles.length === 0 && <div style={s.groupEmpty}>{t("smartDiff.emptyGroup")}</div>}

                  {open &&
                    groupFiles.map((sdFile) => (
                      <SmartDiffFileCard
                        key={sdFile.path}
                        sdFile={sdFile}
                        file={filesByPath.get(sdFile.path) ?? null}
                        t={t}
                        onGoToFinding={onGoToFinding}
                      />
                    ))}
                </div>
              );
            })}
        </>
      )}
    </section>
  );
}

function SmartDiffFileCard({
  sdFile,
  file,
  t,
  onGoToFinding,
}: {
  sdFile: SmartDiffFile;
  file: PrFile | null;
  t: ReturnType<typeof useTranslations>;
  onGoToFinding?: (findingId: string) => void;
}) {
  // File-level expansion: open when this file already has findings, else
  // closed — computed once in the useState initialiser (never AUTO_EXPAND_MAX_LINES).
  const [open, setOpen] = React.useState(() => (sdFile.finding_count ?? 0) > 0);
  const onToggle = () => setOpen((v) => !v);

  const isLarge = !!sdFile.is_large;
  const findingCount = sdFile.finding_count ?? 0;
  const marksByLine = React.useMemo(() => {
    const map = new Map<number, SmartDiffFindingMark>();
    for (const mark of sdFile.finding_marks ?? []) map.set(mark.line, mark);
    return map;
  }, [sdFile.finding_marks]);

  const worstSeverity = worstSeverityOf(sdFile.finding_marks ?? []);
  const lines = file ? parsePatch(file.patch) : [];

  return (
    <div style={s.fileCard(isLarge)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        style={s.fileHeader}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {sdFile.path}
        </span>
        {isLarge && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" style={{ flexShrink: 0 }}>
            {t("smartDiff.largeBadge")}
          </Badge>
        )}
        {findingCount > 0 && worstSeverity && (
          <span style={s.findingsDotWrap}>
            <span style={s.findingsDot(SEVERITY_COLOR[worstSeverity])} />
            <span style={{ fontSize: 12, color: SEVERITY_COLOR[worstSeverity] }}>
              {t("smartDiff.findingsBadge", { count: findingCount })}
            </span>
          </span>
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{sdFile.additions}</span> <span style={s.delText}>−{sdFile.deletions}</span>
        </span>
      </div>

      {open && (
        <div style={s.fileBody}>
          {!file && <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>{sdFile.path}</div>}
          {file &&
            lines.map((ln, i) => (
              <SmartDiffLine
                key={i}
                ln={ln}
                path={sdFile.path}
                mark={ln.newNo != null ? marksByLine.get(ln.newNo) : undefined}
                t={t}
                onGoToFinding={onGoToFinding}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function SmartDiffLine({
  ln,
  path,
  mark,
  t,
  onGoToFinding,
}: {
  ln: Line;
  path: string;
  mark?: SmartDiffFindingMark;
  t: ReturnType<typeof useTranslations>;
  onGoToFinding?: (findingId: string) => void;
}) {
  if (ln.kind === "hunk") {
    return (
      <div style={{ fontSize: 12, lineHeight: "20px", color: "var(--accent-text)", background: "var(--accent-bg)", padding: "0 14px" }}>
        {ln.text}
      </div>
    );
  }

  const rowStyle = mark
    ? { ...lineRowFor(ln.kind), ...s.markLineExtra(SEVERITY_COLOR[mark.severity]) }
    : lineRowFor(ln.kind);

  return (
    <div id={mark ? `sd-${path}-${ln.newNo}` : undefined} style={rowStyle}>
      <span style={s.lineNo} className="mono tnum">
        {ln.newNo ?? ln.oldNo ?? ""}
      </span>
      <span style={lineSignFor(ln.kind)}>{ln.kind === "add" ? "+" : ln.kind === "del" ? "-" : ""}</span>
      <span style={s.lineText} className="mono">
        {ln.text}
      </span>
      {mark && (
        <span style={{ padding: "2px 12px", flexShrink: 0 }}>
          {onGoToFinding ? (
            <button
              type="button"
              onClick={() => onGoToFinding(mark.finding_id)}
              aria-label={t("smartDiff.goToFinding", {
                severity: t(`smartDiff.severityLabel.${mark.severity}`),
              })}
              style={s.markButton}
            >
              <Badge
                color={SEVERITY_COLOR[mark.severity]}
                bg={SEVERITY_BG[mark.severity]}
                icon={mark.severity === "SUGGESTION" ? "Lightbulb" : undefined}
              >
                {t(`smartDiff.severityLabel.${mark.severity}`)}
              </Badge>
            </button>
          ) : (
            <Badge
              color={SEVERITY_COLOR[mark.severity]}
              bg={SEVERITY_BG[mark.severity]}
              icon={mark.severity === "SUGGESTION" ? "Lightbulb" : undefined}
            >
              {t(`smartDiff.severityLabel.${mark.severity}`)}
            </Badge>
          )}
        </span>
      )}
    </div>
  );
}

/** Worst (most severe) mark on a file, for the header's findings dot colour. */
function worstSeverityOf(marks: SmartDiffFindingMark[]): Severity | null {
  if (marks.some((m) => m.severity === "CRITICAL")) return "CRITICAL";
  if (marks.some((m) => m.severity === "WARNING")) return "WARNING";
  if (marks.some((m) => m.severity === "SUGGESTION")) return "SUGGESTION";
  return null;
}
