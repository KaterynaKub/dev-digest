/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A literal Stripe key is committed.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    cost_source: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRunId?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRunId={findingsByRunId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 2, score: 0 })],
      new Map([["run-1", [finding({ id: "f1" }), finding({ id: "f2" })]]]),
    );
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByLabelText("2 critical findings")).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0, score: 72 })],
      new Map([["run-1", [finding({ id: "f1", severity: "WARNING" })]]]),
    );
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.getByLabelText("1 warning findings")).toBeInTheDocument();
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });

  it("falls back to the run's own counts while the reviews query is still loading", () => {
    // No findingsByRunId entry, but the run says it found 5 — claiming "No
    // findings" here would be a flash of wrong data.
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText(/5 finding/)).toBeInTheDocument();
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
    expect(screen.queryByText("No findings")).not.toBeInTheDocument();
  });

  it("hides dismissed findings from the severity chips", () => {
    renderRuns(
      [run({ status: "done", findings_count: 2, blockers: 1, score: 40 })],
      new Map([
        [
          "run-1",
          [
            finding({ id: "f1" }),
            finding({ id: "f2", dismissed_at: "2026-06-11T19:00:00.000Z" }),
          ],
        ],
      ]),
    );
    expect(screen.getByLabelText("1 critical findings")).toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});
