/** Co-located constants for PrBriefCard. */

import type { RiskSeverity } from "@devdigest/shared";

/** Text label per risk level (AC-50, NFR-19 — text, never colour alone) and
 *  the colour that ACCOMPANIES it. Order matches the message keys in
 *  `messages/en/brief.json#riskLevel`. */
export const RISK_LEVEL_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn, #b45309)",
  low: "var(--text-secondary)",
};
