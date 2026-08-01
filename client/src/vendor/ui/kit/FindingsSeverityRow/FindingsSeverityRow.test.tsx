/**
 * FindingsSeverityRow — the severity chips + hover panel shared by the PR list's
 * FINDINGS column and the PR detail timeline.
 *
 * The behaviours worth guarding: the chips must show authoritative counts (which
 * can exceed the capped preview), the panel must survive the pointer travelling
 * into it, and the filter must be a single-select toggle.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { FindingsSeverityRow } from "./FindingsSeverityRow";
import type { FindingsSeverityLabels, SeverityFinding, SeverityKey } from "./types";
import { CLOSE_DELAY_MS } from "./styles";

afterEach(cleanup);

const labels: FindingsSeverityLabels = {
  chip: (severity, count) => `${count} ${severity.toLowerCase()} findings`,
  panelTitle: "Findings",
  filterHint: (severity) => `showing ${severity.toLowerCase()}`,
  more: (count) => `+${count} more`,
  noneForSeverity: "No findings at this severity.",
};

function f(id: string, severity: SeverityKey, title: string): SeverityFinding {
  return {
    id,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    lineLabel: "12",
    confidence: 0.9,
    rationale: `Rationale for ${title}`,
  };
}

const findings: SeverityFinding[] = [
  f("f1", "CRITICAL", "Hardcoded secret"),
  f("f2", "WARNING", "N+1 query"),
  f("f3", "SUGGESTION", "Extract magic number"),
];

function setup(props: Partial<React.ComponentProps<typeof FindingsSeverityRow>> = {}) {
  return render(<FindingsSeverityRow findings={findings} labels={labels} {...props} />);
}

/** Open the panel the way a user does — hovering the chip row. */
function hoverOpen() {
  const chip = screen.getByLabelText("1 critical findings");
  fireEvent.mouseEnter(chip.parentElement!);
  return chip;
}

describe("FindingsSeverityRow — chips", () => {
  it("renders one chip per severity present, and none for absent ones", () => {
    setup({ findings: [f("f1", "CRITICAL", "Only critical")] });
    expect(screen.getByLabelText("1 critical findings")).toBeInTheDocument();
    expect(screen.queryByLabelText(/warning/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/suggestion/)).not.toBeInTheDocument();
  });

  it("prefers the authoritative `counts` over the capped preview list", () => {
    // The PR list sends full counts alongside a truncated item list — the chips
    // must report the real total, not what happens to fit in the panel.
    setup({ counts: { CRITICAL: 20, WARNING: 1, SUGGESTION: 1 } });
    expect(screen.getByLabelText("20 critical findings")).toBeInTheDocument();
  });

  it("renders the empty placeholder instead of chips when there is nothing to show", () => {
    setup({ findings: [], emptyPlaceholder: <span>—</span> });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByLabelText(/findings/)).not.toBeInTheDocument();
  });
});

describe("FindingsSeverityRow — hover panel", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("opens on hover and lists the findings", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    hoverOpen();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("closes after the grace period once the pointer leaves", () => {
    setup();
    const wrap = hoverOpen().parentElement!;
    fireEvent.mouseLeave(wrap);
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // still open during the grace period
    act(() => vi.advanceTimersByTime(CLOSE_DELAY_MS + 20));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays open when the pointer travels from the chips into the panel", () => {
    setup();
    const wrap = hoverOpen().parentElement!;
    fireEvent.mouseLeave(wrap);
    fireEvent.mouseEnter(screen.getByRole("dialog"));
    act(() => vi.advanceTimersByTime(CLOSE_DELAY_MS + 20));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("anchors a short panel to the chips instead of flipping it a max-height away", () => {
    // Regression: positioning reserved PANEL_MAX_HEIGHT (380) rather than
    // measuring the panel. A row near the bottom of the viewport therefore
    // flipped upwards and parked 380px above the chips, even when the panel was
    // only ~150px tall — the gap the bug report showed.
    const PANEL_H = 150;
    const ROW_TOP = 500;
    const ROW_BOTTOM = 520;
    // 768 - 520 = 248px below: enough for a 150px panel, NOT for a 380px one.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PANEL_H);

    setup();
    const wrap = hoverOpen().parentElement!;
    vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
      top: ROW_TOP, bottom: ROW_BOTTOM, left: 100, right: 200,
      width: 100, height: 20, x: 100, y: ROW_TOP, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseLeave(wrap);
    act(() => vi.advanceTimersByTime(CLOSE_DELAY_MS + 20));
    fireEvent.mouseEnter(wrap);

    const top = parseFloat(screen.getByRole("dialog").style.top);
    // Sits just below the chips…
    expect(top).toBeGreaterThanOrEqual(ROW_BOTTOM);
    expect(top).toBeLessThan(ROW_BOTTOM + 20);
    // …and specifically NOT where the max-height guess would have put it.
    expect(top).not.toBeCloseTo(ROW_TOP - 380, 0);
  });

  it("flips above the chips when the panel genuinely does not fit below", () => {
    const PANEL_H = 300;
    const ROW_TOP = 700;
    const ROW_BOTTOM = 720; // only 48px below in a 768px viewport
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PANEL_H);

    setup();
    const wrap = hoverOpen().parentElement!;
    vi.spyOn(wrap, "getBoundingClientRect").mockReturnValue({
      top: ROW_TOP, bottom: ROW_BOTTOM, left: 100, right: 200,
      width: 100, height: 20, x: 100, y: ROW_TOP, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseLeave(wrap);
    act(() => vi.advanceTimersByTime(CLOSE_DELAY_MS + 20));
    fireEvent.mouseEnter(wrap);

    const top = parseFloat(screen.getByRole("dialog").style.top);
    // Bottom edge lands just above the chips, and the panel stays on-screen.
    expect(top + PANEL_H).toBeLessThanOrEqual(ROW_TOP);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("shows the '+N more' footer only when the preview is capped", () => {
    setup({ truncated: 8 });
    hoverOpen();
    expect(screen.getByText("+8 more")).toBeInTheDocument();
    cleanup();
    setup({ truncated: 0 });
    hoverOpen();
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});

describe("FindingsSeverityRow — severity filter", () => {
  it("toggles a single severity: filter, clear, then switch", () => {
    setup();
    hoverOpen();

    // Click CRITICAL → only the critical finding.
    fireEvent.click(screen.getByLabelText("1 critical findings"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();

    // Click the same chip again → back to everything.
    fireEvent.click(screen.getByLabelText("1 critical findings"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();

    // Click a different chip → switch the filter rather than adding to it.
    fireEvent.click(screen.getByLabelText("1 warning findings"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("marks the active chip with aria-pressed", () => {
    setup();
    const critical = hoverOpen();
    expect(critical).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(critical);
    expect(screen.getByLabelText("1 critical findings")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("1 warning findings")).toHaveAttribute("aria-pressed", "false");
  });

  it("reflects the open state via aria-expanded", () => {
    setup();
    expect(screen.getByLabelText("1 critical findings")).toHaveAttribute("aria-expanded", "false");
    hoverOpen();
    expect(screen.getByLabelText("1 critical findings")).toHaveAttribute("aria-expanded", "true");
  });

  it("says so when the active filter matches nothing", () => {
    setup({ counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 3 }, findings: [] });
    const chip = screen.getByLabelText("3 suggestion findings");
    fireEvent.mouseEnter(chip.parentElement!);
    fireEvent.click(chip);
    expect(screen.getByText("No findings at this severity.")).toBeInTheDocument();
  });

  it("Escape closes the panel and clears the filter", () => {
    setup();
    const chip = hoverOpen();
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Re-opening starts unfiltered — a leftover filter reads as missing findings.
    hoverOpen();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });
});
