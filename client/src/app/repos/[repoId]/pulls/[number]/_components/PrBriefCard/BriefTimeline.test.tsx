import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefTimelineEntry } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { BriefTimeline } from "./BriefTimeline";
import { useBriefTimeline } from "@/lib/hooks/reviews";

vi.mock("@/lib/hooks/reviews", () => ({
  useBriefTimeline: vi.fn(),
}));

afterEach(cleanup);

const mockedUseBriefTimeline = vi.mocked(useBriefTimeline);

function queryResult(overrides: Partial<ReturnType<typeof useBriefTimeline>> = {}) {
  return {
    data: undefined,
    isLoading: false,
    ...overrides,
  } as ReturnType<typeof useBriefTimeline>;
}

function makeEntry(overrides: Partial<BriefTimelineEntry> = {}): BriefTimelineEntry {
  return {
    head_sha: "abcdef1234567",
    indexed_sha: "indexsha7654321",
    generated_at: "2026-08-25T10:00:00.000Z",
    risk_level: "medium",
    what: "Adds rate limiting to public API endpoints.",
    is_current: false,
    ...overrides,
  };
}

function renderTimeline(prId: string | null = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages } as never}>
      <BriefTimeline prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("BriefTimeline", () => {
  it("renders nothing when there are fewer than 2 entries", () => {
    mockedUseBriefTimeline.mockReturnValue(queryResult({ data: { entries: [makeEntry()] } }));
    const { container } = renderTimeline();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are 0 entries", () => {
    mockedUseBriefTimeline.mockReturnValue(queryResult({ data: { entries: [] } }));
    const { container } = renderTimeline();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per entry, newest-first as returned by the server", () => {
    mockedUseBriefTimeline.mockReturnValue(
      queryResult({
        data: {
          entries: [
            makeEntry({ head_sha: "newest12345", what: "Adds pagination.", is_current: true }),
            makeEntry({ head_sha: "oldest98765", what: "Adds rate limiting.", is_current: false }),
          ],
        },
      }),
    );
    renderTimeline();

    expect(screen.getByText("newest1")).toBeInTheDocument();
    expect(screen.getByText("oldest9")).toBeInTheDocument();
    expect(screen.getByText("Adds pagination.")).toBeInTheDocument();
    expect(screen.getByText("Adds rate limiting.")).toBeInTheDocument();

    const shas = screen.getAllByText(/newest1|oldest9/).map((el) => el.textContent);
    expect(shas[0]).toBe("newest1");
    expect(shas[1]).toBe("oldest9");
  });

  it("marks a non-current entry with a text badge, not colour alone", () => {
    mockedUseBriefTimeline.mockReturnValue(
      queryResult({
        data: {
          entries: [
            makeEntry({ head_sha: "cur0000", is_current: true }),
            makeEntry({ head_sha: "old0000", is_current: false }),
          ],
        },
      }),
    );
    renderTimeline();

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("loading renders an accessible role=status line", () => {
    mockedUseBriefTimeline.mockReturnValue(queryResult({ isLoading: true }));
    renderTimeline();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/loading brief history/i)).toBeInTheDocument();
  });
});
