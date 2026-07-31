/* RunCostBadge — the USD cost of one agent run (or of a PR's latest review
   cycle), in the two shapes the studio needs: a bare figure for dense rows, and
   a figure + token breakdown for the run-trace stat tile.

   Deliberately i18n-free: it renders in places that mount without an intl
   provider in tests, and the only prose it owns is a hover tooltip. Callers
   localise the surrounding label. */
import React from "react";
import type { CostSource } from "@devdigest/shared";
import { formatCostUsd, NO_VALUE } from "../../lib/format";

/** Why the figure can (or cannot) be trusted — surfaced on hover. */
const TOOLTIP: Record<CostSource, string> = {
  exact: "Actual cost reported by the provider",
  estimated: "Estimated from model pricing — the provider did not report a cost",
  partial: "At least this much — some steps reported no cost",
};

export function RunCostBadge({
  costUsd,
  costSource = null,
  variant = "compact",
  tokensIn,
  tokensOut,
  title,
}: {
  costUsd: number | null | undefined;
  costSource?: CostSource | null;
  /** `detailed` adds a token sub-line; use it where there is vertical room. */
  variant?: "compact" | "detailed";
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Overrides the default source-explaining tooltip. */
  title?: string;
}) {
  const known = costUsd != null && Number.isFinite(costUsd);
  const text = formatCostUsd(costUsd, costSource);
  const tip = title ?? (known && costSource ? TOOLTIP[costSource] : undefined);

  if (!known) {
    return (
      <span title={title} style={{ color: "var(--text-muted)" }}>
        {NO_VALUE}
      </span>
    );
  }

  // An exact figure inherits the surrounding text colour, so it sits at the
  // same weight as whatever it is displayed next to (e.g. the TOKENS tile).
  // Only an estimate or a lower bound is dimmed — there the muting carries
  // meaning: less certain, less prominent.
  const color =
    costSource === "exact" || costSource == null ? undefined : "var(--text-muted)";

  if (variant === "compact") {
    return (
      <span className="tnum" title={tip} style={{ color }}>
        {text}
      </span>
    );
  }

  return (
    <span title={tip} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span className="tnum" style={{ color }}>
        {text}
      </span>
      {tokensIn != null && tokensOut != null && (
        <span className="tnum" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {formatTokenPair(tokensIn, tokensOut)}
        </span>
      )}
    </span>
  );
}

/** "12k→1.5k" — mirrors the trace drawer's own token summary. */
function formatTokenPair(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

export default RunCostBadge;
