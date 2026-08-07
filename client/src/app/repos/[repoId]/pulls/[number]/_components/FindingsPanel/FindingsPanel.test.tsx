import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

// jsdom does not implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function makeFinding(overrides: Partial<FindingRecord>): FindingRecord {
  return { ...FINDINGS[0]!, ...overrides };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("scrolls to the node carrying the target finding's data-finding-id, and scrolls again on a nonce bump", () => {
    const findings = [
      makeFinding({ id: "f1", title: "First finding" }),
      makeFinding({ id: "f2", title: "Second finding" }),
    ];
    const { rerender } = renderWithIntl(
      <FindingsPanel findings={findings} prId="pr1" targetFindingId="f2" targetNonce={1} />,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={findings} prId="pr1" targetFindingId="f2" targetNonce={2} />
      </NextIntlClientProvider>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("un-hides a hideLow-hidden target instead of swallowing it", async () => {
    const findings = [
      makeFinding({ id: "f1", title: "Normal confidence", confidence: 0.9 }),
      makeFinding({ id: "f2", title: "Low confidence target", confidence: 0.1 }),
    ];
    const { rerender } = renderWithIntl(<FindingsPanel findings={findings} prId="pr1" />);

    // Turn "hide low confidence" on — the low-confidence target disappears.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Low confidence target")).not.toBeInTheDocument();

    // Now request that hidden finding as the navigation target: the filter
    // must turn itself off rather than swallow it.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={findings} prId="pr1" targetFindingId="f2" targetNonce={1} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("Low confidence target")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("an unknown target finding id is a silent no-op", () => {
    const findings = [makeFinding({ id: "f1" })];
    expect(() =>
      renderWithIntl(<FindingsPanel findings={findings} prId="pr1" targetFindingId="unknown-id" targetNonce={1} />),
    ).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
