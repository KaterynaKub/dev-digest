import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "security",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "review-1",
    pr_id: "pr1",
    agent_id: "agent-1",
    run_id: null,
    agent_name: "Reviewer Bot",
    kind: "review",
    verdict: "comment",
    summary: "Looks fine.",
    score: 80,
    model: "gpt",
    grounding: null,
    created_at: new Date().toISOString(),
    findings: [makeFinding()],
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ReviewRunAccordion", () => {
  it("opens by finding membership even when defaultOpen is false and run_id is null", () => {
    const review = makeReview({ run_id: null, findings: [makeFinding({ id: "target-finding" })] });
    renderWithProviders(
      <ReviewRunAccordion
        review={review}
        prId="pr1"
        defaultOpen={false}
        targetFindingId="target-finding"
        targetNonce={1}
      />,
    );

    // The body (VerdictBanner summary) only renders when the accordion is open.
    expect(screen.getByText("Looks fine.")).toBeInTheDocument();
  });

  it("stays closed when the target finding belongs to a different review", () => {
    const review = makeReview({ run_id: null, findings: [makeFinding({ id: "other-finding" })] });
    renderWithProviders(
      <ReviewRunAccordion
        review={review}
        prId="pr1"
        defaultOpen={false}
        targetFindingId="target-finding"
        targetNonce={1}
      />,
    );

    expect(screen.queryByText("Looks fine.")).not.toBeInTheDocument();
  });
});
