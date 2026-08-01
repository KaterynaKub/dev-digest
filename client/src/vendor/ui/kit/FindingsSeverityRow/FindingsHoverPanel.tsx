import React from "react";
import { SEV, CategoryTag, MonoLink, ConfidenceNum } from "../../primitives";
import type { Category, Severity } from "../../primitives";
import { Icon } from "../../icons";
import { s } from "./styles";
import type { FindingsSeverityLabels, SeverityFinding, SeverityKey } from "./types";

/**
 * The floating panel body: a scrolling list of findings, optionally narrowed to
 * one severity. Layout mirrors FindingCard's header (severity, title, category,
 * file:line, confidence) minus the expand/accept/dismiss affordances — this is
 * a preview, so the full card stays the place to act on a finding.
 */
export const FindingsHoverPanel = React.forwardRef<
  HTMLDivElement,
  {
    findings: SeverityFinding[];
    filter: SeverityKey | null;
    truncated: number;
    labels: FindingsSeverityLabels;
    panelId: string;
    top: number;
    left: number;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  }
>(function FindingsHoverPanel(
  { findings, filter, truncated, labels, panelId, top, left, onMouseEnter, onMouseLeave },
  ref,
) {
  const visible = filter ? findings.filter((f) => f.severity === filter) : findings;

  return (
    <div
      ref={ref}
      id={panelId}
      role="dialog"
      aria-label={labels.panelTitle}
      style={s.panel(top, left)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div style={s.panelHeader}>
        <span>{labels.panelTitle}</span>
        {filter && labels.filterHint && (
          <span style={s.filterHint}>{labels.filterHint(filter)}</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div style={s.empty}>{labels.noneForSeverity}</div>
      ) : (
        <div style={s.list}>
          {visible.map((f) => (
            <div key={f.id} style={s.item}>
              <div style={s.itemTitleRow}>
                {/* Bare severity glyph, not SeverityBadge's filled pill — the
                    row already reads as one finding, so the plate is noise. */}
                {(() => {
                  const sev = SEV[f.severity as Severity];
                  const SevIcon = Icon[sev.icon];
                  return <SevIcon size={14} style={{ color: sev.c, flexShrink: 0 }} />;
                })()}
                <span style={s.itemTitle} title={f.title}>
                  {f.title}
                </span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.itemMetaRow}>
                {/* MonoLink's anchor branch stops propagation itself, so the
                    PR row's navigation handler never fires from this link.
                    Wrapped because the ellipsis has to live on a element we
                    control — the primitive is shared with FindingCard, which
                    wants the path to wrap rather than truncate. */}
                <span style={s.itemMetaPath} title={`${f.file}:${f.lineLabel}`}>
                  <MonoLink href={f.href}>
                    {f.file}:{f.lineLabel}
                  </MonoLink>
                </span>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div style={s.itemRationale} title={f.rationale}>
                {f.rationale}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Without this the chips ("20") visibly disagree with the list ("12"). */}
      {truncated > 0 && !filter && <div style={s.footer}>{labels.more(truncated)}</div>}
    </div>
  );
});
