/** Hover tooltip for a mark badge — shows the finding's title + rationale.
 *
 *  `position: fixed`, not absolute, for the same reason `FindingsHoverPanel`
 *  does it: `s.fileCard` sets `overflow: hidden`, which would clip an absolutely
 *  positioned tooltip against the file card's edge. Nothing in this tree
 *  establishes a containing block (no transform/filter/contain), so `fixed` is
 *  measured against the viewport as intended and no portal is needed.
 *
 *  Rendered only while hovered — it is a preview, so it is never in the DOM
 *  otherwise and costs nothing on the many rows that have no finding. */
"use client";

import React from "react";
import { TOOLTIP_MAX_WIDTH, TOOLTIP_OFFSET, VIEWPORT_MARGIN, s } from "./styles";

export interface FindingTooltipProps {
  title?: string;
  rationale?: string;
  /** Fallback line when the mark's finding could not be joined. */
  fallback: string;
  /** Bounding rect of the badge this tooltip describes. */
  anchor: DOMRect;
  tooltipId: string;
}

export function FindingTooltip({ title, rationale, fallback, anchor, tooltipId }: FindingTooltipProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  /**
   * Placed against the tooltip's REAL measured height in a layout effect, so
   * the flip decision is correct for a one-line tooltip and a six-line one
   * alike, and the move lands before paint (no flash at the unplaced position).
   */
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const place = () => {
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const spaceBelow = window.innerHeight - anchor.bottom - TOOLTIP_OFFSET - VIEWPORT_MARGIN;
      // Prefer below; flip above only when it genuinely does not fit AND there
      // is more room up there.
      const flipUp = h > spaceBelow && anchor.top - TOOLTIP_OFFSET - VIEWPORT_MARGIN > spaceBelow;

      let top = flipUp ? anchor.top - TOOLTIP_OFFSET - h : anchor.bottom + TOOLTIP_OFFSET;
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - h - VIEWPORT_MARGIN));

      // Right-aligned to the badge (the badge sits at the row's right edge, so
      // a left-aligned tooltip would hang off-screen), then clamped.
      const rawLeft = anchor.right - w;
      const maxLeft = window.innerWidth - w - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));

      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  return (
    <div
      ref={ref}
      id={tooltipId}
      role="tooltip"
      style={{
        ...s.tooltip,
        // Until measured, keep it out of sight rather than flashing at 0,0 —
        // `visibility` (not `display`) so it still has a measurable box.
        ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }),
        maxWidth: TOOLTIP_MAX_WIDTH,
      }}
    >
      {title ? (
        <>
          <div style={s.tooltipTitle}>{title}</div>
          {rationale && <div style={s.tooltipRationale}>{rationale}</div>}
        </>
      ) : (
        <div style={s.tooltipRationale}>{fallback}</div>
      )}
    </div>
  );
}
