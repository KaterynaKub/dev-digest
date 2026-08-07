/* SmartDiffSection — "REVIEWER-ORDERED DIFF": groups the PR's files into
   core/wiring/boilerplate (server-derived, deterministic, no model call) and
   overlays severity highlights from past reviews. A Smart/Original order
   toggle lets the reviewer flip back to the plain file list: in "original" the
   section collapses to its header + stats + toggle (the grouped view is NOT
   rendered) and DiffTab renders the plain DiffViewer below instead. The toggle
   itself stays mounted in both modes — it is the only way back to "smart".

   Deliberate omissions (do not "restore" on a future read):
   - `pseudocode_summary` is never rendered (no "What this does" block, no
     "summary" badge) even though the contract carries the field — out of
     scope for this pass, see spec 0005b.
   - Navigating from a mark to its finding's card (spec 0005c) wraps the badge
     in a button ONLY when `onGoToFinding` is supplied, so this component stays
     renderable without a navigation host.

   Finding highlights span the whole BLOCK (`start_line`..`end_line`), not just
   the marked line. `SmartDiffFindingMark` carries only `line`, so the span comes
   from the PR's `FindingRecord`s joined by `finding_id` on the client (`findings`
   prop) — see helpers.ts for why that join lives here and not in the contract.
   Overlapping blocks are resolved there too: worst severity wins the resting
   tint, every block badges once at its own start, and HOVER follows the
   latest-starting (innermost) block rather than the worst one.

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
import type {
  FindingRecord,
  PrFile,
  SmartDiffFile,
  SmartDiffFindingMark,
  SmartDiffRole,
  Severity,
} from "@devdigest/shared";
import {
  GROUP_DEFAULT_OPEN,
  GROUP_ORDER,
  ROLE_COLOR,
  SEVERITY_BG,
  SEVERITY_COLOR,
  SEVERITY_ROW_BG,
  SEVERITY_ROW_BG_HOVER,
} from "./constants";
import {
  buildLineCoverage,
  resolveFindingBlocks,
  type FindingBlock,
  type LineCoverage,
} from "./helpers";
import { FindingTooltip } from "./FindingTooltip";
import { chevronFor, s } from "./styles";

export interface SmartDiffSectionProps {
  prId: string | null;
  files: PrFile[];
  order: "smart" | "original";
  onOrderChange: (order: "smart" | "original") => void;
  /** The PR's persisted findings, used to widen each `finding_marks` entry into
   *  its full `start_line`..`end_line` block and to fill the badge tooltip.
   *  Optional: without them every mark degrades to the single-line highlight
   *  this component shipped with, and tooltips fall back to a muted line. */
  findings?: FindingRecord[];
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

export function SmartDiffSection({
  prId,
  files,
  order,
  onOrderChange,
  findings,
  onGoToFinding,
}: SmartDiffSectionProps) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError } = useSmartDiff(prId);
  const isSmart = order === "smart";

  // Marks reference findings by id; this is the join side. Built once per
  // findings change rather than per file card.
  const findingsById = React.useMemo(() => {
    const map = new Map<string, FindingRecord>();
    for (const f of findings ?? []) map.set(f.id, f);
    return map;
  }, [findings]);

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

      {/* Everything below the toggle is the reviewer-ordered view itself — it
          renders only in "smart" mode. In "original" mode this section keeps
          just its header, stats and the toggle, and DiffTab renders the plain
          DiffViewer below instead. */}
      {isSmart && isLoading && (
        <div>
          <div role="status" aria-live="polite" style={{ marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }}>
            {t("smartDiff.loading")}
          </div>
          <Skeleton height={80} />
        </div>
      )}

      {isSmart && isError && (
        <div style={{ fontSize: 13, color: "var(--crit)", marginBottom: 12 }}>{t("smartDiff.error")}</div>
      )}

      {isSmart && !isLoading && !isError && data && (
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
                        findingsById={findingsById}
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
  findingsById,
  t,
  onGoToFinding,
}: {
  sdFile: SmartDiffFile;
  file: PrFile | null;
  findingsById: Map<string, FindingRecord>;
  t: ReturnType<typeof useTranslations>;
  onGoToFinding?: (findingId: string) => void;
}) {
  // File-level expansion: open when this file already has findings, else
  // closed — computed once in the useState initialiser (never AUTO_EXPAND_MAX_LINES).
  const [open, setOpen] = React.useState(() => (sdFile.finding_count ?? 0) > 0);
  const onToggle = () => setOpen((v) => !v);

  const isLarge = !!sdFile.is_large;
  const findingCount = sdFile.finding_count ?? 0;
  // Marks carry only a start line; the joined findings supply each block's
  // `end_line`, so coverage spans the whole block and resolves overlaps.
  const coverageByLine = React.useMemo(
    () => buildLineCoverage(resolveFindingBlocks(sdFile.finding_marks ?? [], findingsById)),
    [sdFile.finding_marks, findingsById],
  );

  const worstSeverity = worstSeverityOf(sdFile.finding_marks ?? []);
  const lines = file ? parsePatch(file.patch) : [];

  // Hover lives HERE, not in the row: hovering one finding has to light up every
  // row of that finding, which no single row can know on its own. The file card
  // holds the hovered finding_id and each row asks whether it is covered by it.
  const [hoveredFindingId, setHoveredFindingId] = React.useState<string | null>(null);

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
                coverage={ln.newNo != null ? coverageByLine.get(ln.newNo) : undefined}
                hoveredFindingId={hoveredFindingId}
                onHoverFinding={setHoveredFindingId}
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
  coverage,
  hoveredFindingId,
  onHoverFinding,
  t,
  onGoToFinding,
}: {
  ln: Line;
  path: string;
  /** Findings covering this row (worst severity + blocks starting here). */
  coverage?: LineCoverage;
  /** The finding currently hovered anywhere in this file card, or null. */
  hoveredFindingId: string | null;
  onHoverFinding: (findingId: string | null) => void;
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

  // Hover is state, not CSS: these rows are styled with inline `style` objects
  // (no CSS module / styled-component in this tree), and inline styles cannot
  // express `:hover`. It is also not a per-row boolean — hovering one row of a
  // finding must light up ALL of that finding's rows, so the hovered finding id
  // is owned by the file card and every row derives its own state from it.
  const hoveredBlock = coverage?.blocks.find((b) => b.finding_id === hoveredFindingId);
  const isHovered = hoveredBlock != null;

  // When a hovered block overlaps a worse one, the hover tint follows the
  // HOVERED finding, not the row's worst severity — otherwise hovering the
  // nested WARNING would light up in the enclosing CRITICAL's red and the
  // reviewer could not tell which finding they are actually tracing.
  const tintSeverity = hoveredBlock?.severity ?? coverage?.severity;
  // Edges are drawn for the hovered block alone while hovering (its exact span
  // is the question being asked); otherwise for whatever block boundaries the
  // row genuinely carries.
  const edges = hoveredBlock
    ? {
        isBlockStart: ln.newNo === hoveredBlock.startLine,
        isBlockEnd: ln.newNo === hoveredBlock.endLine,
      }
    : {
        isBlockStart: (coverage?.startsHere.length ?? 0) > 0,
        isBlockEnd: !!coverage?.isBlockEnd,
      };

  // A tooltip opens inside THIS row's badge slot, and every covered row is
  // `position: relative` — so without lifting the row, the rows below it (later
  // in the DOM, same painting layer) draw over the tooltip and their badges show
  // through it. Lifting only the row that owns the open tooltip keeps the rest
  // of the diff in the default layer.
  const ownsOpenTooltip = coverage?.startsHere.some((b) => b.finding_id === hoveredFindingId) ?? false;

  const rowStyle =
    coverage && tintSeverity
      ? {
          ...lineRowFor(ln.kind),
          ...s.markLineExtra(
            SEVERITY_COLOR[coverage.severity],
            (isHovered ? SEVERITY_ROW_BG_HOVER : SEVERITY_ROW_BG)[tintSeverity],
            SEVERITY_ROW_BG_HOVER[tintSeverity],
            edges,
          ),
          ...(ownsOpenTooltip ? s.rowWithOpenTooltip : null),
        }
      : lineRowFor(ln.kind);

  // Hovering anywhere on a covered row traces the row's INNERMOST finding — the
  // one that starts latest. Where blocks overlap that is the more specific claim
  // about this row, and the one hardest to reach by pointer (its badge sits on
  // its own first row, possibly far above). Note this is deliberately NOT the
  // row's worst severity, so hovering a nested SUGGESTION inside a CRITICAL
  // traces the suggestion — and the tint follows suit via `tintSeverity`.
  const rowFinding = coverage?.innermost.finding_id;

  // The row keeps its `sd-<path>-<line>` id on every covered row, not just a
  // block's first: `goToFinding` scrolls to a finding's start_line, and a
  // continuation row is a legitimate anchor for a finding that starts above.
  return (
    <div
      id={coverage ? `sd-${path}-${ln.newNo}` : undefined}
      style={rowStyle}
      onMouseEnter={rowFinding ? () => onHoverFinding(rowFinding) : undefined}
      onMouseLeave={rowFinding ? () => onHoverFinding(null) : undefined}
    >
      <span style={s.lineNo} className="mono tnum">
        {ln.newNo ?? ln.oldNo ?? ""}
      </span>
      <span style={lineSignFor(ln.kind)}>{ln.kind === "add" ? "+" : ln.kind === "del" ? "-" : ""}</span>
      <span style={s.lineText} className="mono">
        {ln.text}
      </span>
      {/* One badge per block STARTING here — a continuation row shows none, so a
          20-line finding is one tinted stripe with a single badge at its top.
          Overlapping blocks each badge on their own first row. */}
      {coverage && coverage.startsHere.length > 0 && (
        <span style={s.markBadgeSlot}>
          {coverage.startsHere.map((block) => (
            <MarkBadge
              key={block.finding_id}
              block={block}
              onHoverFinding={onHoverFinding}
              rowFindingId={rowFinding}
              t={t}
              onGoToFinding={onGoToFinding}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** Severity badge for one finding block, with a hover tooltip carrying the
 *  finding's title + rationale. Absolutely positioned by `markBadgeSlot`, so it
 *  never contributes to the diff row's height. */
function MarkBadge({
  block,
  onHoverFinding,
  rowFindingId,
  t,
  onGoToFinding,
}: {
  block: FindingBlock;
  onHoverFinding: (findingId: string | null) => void;
  /** The finding the badge's own row traces — restored when the pointer leaves
   *  the badge but is still inside that row. */
  rowFindingId?: string;
  t: ReturnType<typeof useTranslations>;
  onGoToFinding?: (findingId: string) => void;
}) {
  // The tooltip is `position: fixed`, so it needs the badge's viewport rect.
  // Captured on enter rather than measured in the tooltip: the badge is the
  // anchor, and reading its rect here keeps the tooltip a pure renderer.
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const ref = React.useRef<HTMLSpanElement>(null);
  const tooltipId = React.useId();

  // Hovering the badge does two things at once: opens the tooltip AND claims the
  // file-card-wide hover for THIS finding, so every row of this block lights up
  // even when the row underneath the pointer belongs to a worse, enclosing one.
  const show = () => {
    setAnchor(ref.current?.getBoundingClientRect() ?? null);
    onHoverFinding(block.finding_id);
  };
  // Leaving the badge closes the tooltip but hands the hover back to the row the
  // badge sits on, rather than clearing it: the pointer is still inside that row,
  // and clearing here would drop the highlight while the cursor has not left it.
  const hide = () => {
    setAnchor(null);
    onHoverFinding(rowFindingId ?? null);
  };

  const severityLabel = t(`smartDiff.severityLabel.${block.severity}`);
  const badge = (
    <Badge
      color={SEVERITY_COLOR[block.severity]}
      bg={SEVERITY_BG[block.severity]}
      icon={block.severity === "SUGGESTION" ? "Lightbulb" : undefined}
      style={s.markBadgeCompact}
    >
      {severityLabel}
    </Badge>
  );

  return (
    <span
      ref={ref}
      style={s.markBadgeWrap}
      onMouseEnter={show}
      onMouseLeave={hide}
      // Keyboard parity: the tooltip follows focus too, not just the pointer.
      onFocus={show}
      onBlur={hide}
    >
      {onGoToFinding ? (
        <button
          type="button"
          onClick={() => onGoToFinding(block.finding_id)}
          aria-label={t("smartDiff.goToFinding", { severity: severityLabel })}
          aria-describedby={anchor ? tooltipId : undefined}
          style={s.markButton}
        >
          {badge}
        </button>
      ) : (
        badge
      )}
      {anchor && (
        <FindingTooltip
          title={block.title}
          rationale={block.rationale}
          fallback={t("smartDiff.tooltipUnavailable")}
          anchor={anchor}
          tooltipId={tooltipId}
        />
      )}
    </span>
  );
}

/** Worst (most severe) mark on a file, for the header's findings dot colour. */
function worstSeverityOf(marks: SmartDiffFindingMark[]): Severity | null {
  if (marks.some((m) => m.severity === "CRITICAL")) return "CRITICAL";
  if (marks.some((m) => m.severity === "WARNING")) return "WARNING";
  if (marks.some((m) => m.severity === "SUGGESTION")) return "SUGGESTION";
  return null;
}
