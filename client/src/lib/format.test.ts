import { describe, it, expect } from "vitest";
import { formatCostUsd } from "./format";

describe("formatCostUsd", () => {
  // The acceptance rule: >= 3 significant digits, so a sub-cent run reads
  // "$0.0013" and never rounds away to "$0.00".
  it.each([
    [0.0013, "$0.0013"],
    [0.014, "$0.014"],
    [0.06, "$0.06"],
    [0.00004, "$0.00004"],
    [0.012345, "$0.0123"],
    [1.234, "$1.23"],
    [12.3, "$12.30"],
  ])("formats %d as %s", (usd, expected) => {
    expect(formatCostUsd(usd, "exact")).toBe(expected);
  });

  // A run with no cost data must not claim it was free.
  it.each([[null], [undefined], [NaN]])("renders %s as an em dash", (usd) => {
    expect(formatCostUsd(usd as number | null | undefined, "exact")).toBe("—");
  });

  // Zero is a REAL price (free models), not missing data — the distinction the
  // whole null-vs-0 discipline in this feature exists to protect.
  it("renders a genuine zero cost as $0", () => {
    expect(formatCostUsd(0, "exact")).toBe("$0");
    expect(formatCostUsd(0, null)).toBe("$0");
  });

  it("prefixes estimates with ~ and lower bounds with >=", () => {
    expect(formatCostUsd(0.0123, "estimated")).toBe("~$0.0123");
    expect(formatCostUsd(0.0123, "partial")).toBe("≥$0.0123");
    expect(formatCostUsd(0.0123, "exact")).toBe("$0.0123");
  });

  it("omits the prefix when the source is unknown", () => {
    expect(formatCostUsd(0.0123)).toBe("$0.0123");
    expect(formatCostUsd(0.0123, null)).toBe("$0.0123");
  });
});
