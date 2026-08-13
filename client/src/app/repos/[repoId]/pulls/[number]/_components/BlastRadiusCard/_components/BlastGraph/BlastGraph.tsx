/* BlastGraph — inline-SVG, two-layer deterministic rendering of the same
   `downstream[]` data the Tree view uses. No new dependency (no d3/cytoscape/
   react-flow — client/package.json has none and none is added here), no
   separate fetch, no force simulation (spec 0007-blast-radius.md §6.2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { NODE_RADIUS, SVG_WIDTH } from "./constants";
import { buildBlastGraphLayout } from "./helpers";
import { s } from "./styles";

export interface BlastGraphProps {
  downstream: DownstreamImpact[];
}

export function BlastGraph({ downstream }: BlastGraphProps) {
  const t = useTranslations("blast");

  if (downstream.length === 0) {
    return <div style={s.empty}>{t("graph.empty")}</div>;
  }

  const layout = buildBlastGraphLayout(downstream);
  const totalHiddenCallers = Object.values(layout.hiddenCallerCountBySymbol).reduce(
    (sum, n) => sum + n,
    0,
  );

  return (
    <div style={s.wrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${SVG_WIDTH} ${layout.height}`}
        style={s.svg}
      >
        {layout.edges.map((edge) => {
          const from = layout.symbolNodes.find((n) => n.id === edge.fromId);
          const to = layout.callerNodes.find((n) => n.id === edge.toId);
          if (!from || !to) return null;
          // Straight edge with a slight horizontal bow via a quadratic curve,
          // computed purely from the two endpoints — no randomness.
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={edge.id}
              d={`M ${from.x} ${from.y} Q ${midX} ${from.y}, ${midX} ${(from.y + to.y) / 2} T ${to.x} ${to.y}`}
              style={s.edge}
            />
          );
        })}

        {layout.symbolNodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={NODE_RADIUS + 1} style={s.symbolNode} />
            <text x={node.x - NODE_RADIUS - 8} y={node.y + 4} textAnchor="end" style={s.symbolLabel}>
              {node.label}
            </text>
          </g>
        ))}

        {layout.callerNodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={NODE_RADIUS} style={s.callerNode} />
            <text x={node.x + NODE_RADIUS + 8} y={node.y + 4} style={s.callerLabel}>
              {node.label}
            </text>
          </g>
        ))}
      </svg>

      {(layout.hiddenSymbolCount > 0 || totalHiddenCallers > 0) && (
        <div style={s.moreLine}>
          {t("graph.more", { count: layout.hiddenSymbolCount + totalHiddenCallers })}
        </div>
      )}
    </div>
  );
}
