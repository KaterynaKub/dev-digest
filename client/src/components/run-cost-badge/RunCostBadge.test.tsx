import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";

describe("RunCostBadge", () => {
  it("shows an exact cost without a qualifier", () => {
    render(<RunCostBadge costUsd={0.0123} costSource="exact" />);
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
  });

  it("marks estimates and lower bounds", () => {
    const { rerender } = render(<RunCostBadge costUsd={0.0123} costSource="estimated" />);
    expect(screen.getByText("~$0.0123")).toBeInTheDocument();

    rerender(<RunCostBadge costUsd={0.0123} costSource="partial" />);
    expect(screen.getByText("≥$0.0123")).toBeInTheDocument();
  });

  // The acceptance criterion: an unfinished run must not look free.
  it("renders an em dash — not $0.00 — when the cost is unknown", () => {
    render(<RunCostBadge costUsd={null} costSource={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  // A free model really does cost 0; that is data, not a missing value.
  it("renders a genuine zero as $0", () => {
    render(<RunCostBadge costUsd={0} costSource="exact" />);
    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("adds a token breakdown only in the detailed variant", () => {
    const { rerender } = render(
      <RunCostBadge costUsd={0.06} costSource="exact" variant="detailed" tokensIn={15000} tokensOut={1200} />,
    );
    expect(screen.getByText("$0.06")).toBeInTheDocument();
    expect(screen.getByText("15k→1.2k")).toBeInTheDocument();

    rerender(
      <RunCostBadge costUsd={0.06} costSource="exact" variant="compact" tokensIn={15000} tokensOut={1200} />,
    );
    expect(screen.queryByText("15k→1.2k")).not.toBeInTheDocument();
  });
});
