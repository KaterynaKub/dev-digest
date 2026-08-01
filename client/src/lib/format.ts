import type { CostSource } from "@devdigest/shared";

/**
 * Shared display formatters.
 *
 * Cost figures appear in four different places (PR list, run timeline, run
 * trace, review-run accordion), so the rules live here rather than colocated
 * with any one of them.
 */

/** Rendered when a figure is unknown. NOT "$0.00" — see `formatCostUsd`. */
export const NO_VALUE = "—";

/** Prefix that communicates how trustworthy a cost figure is. */
const PREFIX: Record<CostSource, string> = {
  exact: "", // the provider billed exactly this
  estimated: "~", // price-book math
  partial: "≥", // lower bound: part of the run had no price
};

/**
 * A USD cost, at >= 3 significant digits so sub-cent runs stay readable
 * ("$0.0013", never "$0.00").
 *
 * Unknown (null/undefined/NaN) renders as "—": an unfinished, failed or
 * cancelled run has no price, and showing "$0.00" would claim it was free.
 * Zero, on the other hand, is a REAL price — free models exist — so it renders
 * as "$0".
 */
export function formatCostUsd(
  usd: number | null | undefined,
  source?: CostSource | null,
): string {
  if (usd == null || !Number.isFinite(usd)) return NO_VALUE;
  if (usd === 0) return "$0";
  return `${source ? PREFIX[source] : ""}$${significant(usd)}`;
}

/** 3 significant digits, at least 2 decimal places, no trailing zeros. */
function significant(n: number): string {
  // Number() collapses the exponent form toPrecision can produce (1e-7).
  const p = Number(n.toPrecision(3));
  // Below $1, reaching 3 significant digits needs extra decimals; toFixed caps
  // at 20. At or above $1, two decimals already carry 3+ digits.
  const decimals =
    Math.abs(p) < 1
      ? Math.min(20, Math.max(2, -Math.floor(Math.log10(Math.abs(p))) + 2))
      : 2;
  return trimZeros(p.toFixed(decimals));
}

/** Drop trailing zeros but keep at least two decimal places. */
function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  const [int, dec = ""] = s.split(".");
  return `${int}.${dec.replace(/0+$/, "").padEnd(2, "0")}`;
}
