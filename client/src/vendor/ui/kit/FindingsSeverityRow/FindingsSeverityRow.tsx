"use client";

import React from "react";
import { SEV } from "../../primitives";
import type { Severity } from "../../primitives";
import { Icon } from "../../icons";
import { FindingsHoverPanel } from "./FindingsHoverPanel";
import {
  CLOSE_DELAY_MS,
  PANEL_OFFSET,
  PANEL_WIDTH,
  VIEWPORT_MARGIN,
  s,
} from "./styles";
import { SEVERITY_KEYS, type FindingsSeverityRowProps, type SeverityKey } from "./types";

/**
 * Compact per-severity finding counts with a hover panel listing the findings
 * themselves. Used by the PR list's FINDINGS column and by each run card in the
 * PR detail timeline.
 *
 * Clicking a severity chip filters the panel to that severity; clicking the
 * same chip again clears the filter (single-select toggle).
 *
 * The panel is `position: fixed` rather than absolute: the PR list's table card
 * sets `overflow: hidden`, which would clip an absolutely positioned panel. No
 * ancestor establishes a containing block (no transform/filter/contain), so
 * `fixed` is measured against the viewport as intended.
 */
export function FindingsSeverityRow({
  findings,
  counts,
  truncated = 0,
  align = "left",
  hideEmpty = true,
  emptyPlaceholder = null,
  labels,
}: FindingsSeverityRowProps) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<SeverityKey | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = React.useId();

  const effectiveCounts = React.useMemo(() => {
    if (counts) return counts;
    const derived: Record<SeverityKey, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
    for (const f of findings) {
      if (f.severity in derived) derived[f.severity] += 1;
    }
    return derived;
  }, [counts, findings]);

  const total = SEVERITY_KEYS.reduce((n, k) => n + (effectiveCounts[k] ?? 0), 0);

  const clearTimer = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openNow = React.useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  /**
   * Position against the panel's REAL height, measured after it renders.
   * Using the max height here instead would flip a short panel upwards long
   * before it actually needs to, and then park it a full max-height above the
   * chips — visibly detached from what it describes.
   *
   * Layout effect, so the move happens before paint (no flash at 0,0).
   */
  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = wrapRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const place = () => {
      const r = trigger.getBoundingClientRect();
      const h = panel.offsetHeight;
      const spaceBelow = window.innerHeight - r.bottom - PANEL_OFFSET - VIEWPORT_MARGIN;
      // Flip up only when it genuinely does not fit below AND there is more
      // room above; otherwise stay below and let the list scroll internally.
      const flipUp = h > spaceBelow && r.top - PANEL_OFFSET - VIEWPORT_MARGIN > spaceBelow;

      let top = flipUp ? r.top - PANEL_OFFSET - h : r.bottom + PANEL_OFFSET;
      // Clamp so an oversized panel is trimmed at the viewport edge, never
      // pushed off-screen.
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - h - VIEWPORT_MARGIN));

      const rawLeft = align === "right" ? r.right - PANEL_WIDTH : r.left;
      const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));

      setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
    };

    place();
    // The filter changes how many rows the panel holds, so re-place on resize
    // and whenever its content box changes size.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, align, filter]);

  /** Grace period so the pointer can cross the gap into the panel. */
  const closeSoon = React.useCallback(() => {
    clearTimer();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      // Reset the filter so the next hover starts clean — a filter left over
      // from a previous hover reads as missing findings.
      setFilter(null);
    }, CLOSE_DELAY_MS);
  }, [clearTimer]);

  const closeNow = React.useCallback(() => {
    clearTimer();
    setOpen(false);
    setFilter(null);
  }, [clearTimer]);

  // A pending timer firing after unmount would set state on a dead component.
  React.useEffect(() => clearTimer, [clearTimer]);

  const handleChipClick = (severity: SeverityKey) => {
    setFilter((f) => (f === severity ? null : severity));
    if (!open) openNow();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      closeNow();
    }
  };

  // Keyboard users: keep the panel open while focus stays inside it.
  const handleBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current?.contains(next)) return;
    closeSoon();
  };

  if (total === 0) return <>{emptyPlaceholder}</>;

  const visibleKeys = SEVERITY_KEYS.filter((k) => !hideEmpty || (effectiveCounts[k] ?? 0) > 0);

  return (
    <div
      ref={wrapRef}
      style={s.wrap}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      {visibleKeys.map((key) => {
        const count = effectiveCounts[key] ?? 0;
        const active = filter === key;
        const sev = SEV[key as Severity];
        const SevIcon = Icon[sev.icon];
        return (
          <button
            key={key}
            type="button"
            aria-label={labels.chip(key, count)}
            aria-pressed={active}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => handleChipClick(key)}
            onFocus={openNow}
            style={s.chipButton(sev.c, active, filter !== null && !active)}
          >
            <SevIcon size={13} />
            <span style={s.chipCount}>{count}</span>
          </button>
        );
      })}

      {open && (
        <FindingsHoverPanel
          ref={panelRef}
          findings={findings}
          filter={filter}
          truncated={truncated}
          labels={labels}
          panelId={panelId}
          top={pos.top}
          left={pos.left}
          onMouseEnter={clearTimer}
          onMouseLeave={closeSoon}
        />
      )}
    </div>
  );
}
