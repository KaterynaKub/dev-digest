import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBriefRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { PrBriefCard } from "./PrBriefCard";
import { useBrief, useGenerateBrief, useBriefTimeline } from "@/lib/hooks/reviews";

vi.mock("@/lib/hooks/reviews", () => ({
  useBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
  useBriefTimeline: vi.fn(),
}));

afterEach(cleanup);

const mockedUseBrief = vi.mocked(useBrief);
const mockedUseGenerateBrief = vi.mocked(useGenerateBrief);
const mockedUseBriefTimeline = vi.mocked(useBriefTimeline);

// This suite is about the brief itself, not the timeline (that lives in
// BriefTimeline.test.tsx) — default every test to a resolved, empty timeline
// so `PrBriefCard`'s rendering of `<BriefTimeline>` never adds noise here.
mockedUseBriefTimeline.mockReturnValue({
  data: { entries: [] },
  isLoading: false,
} as unknown as ReturnType<typeof useBriefTimeline>);

function queryResult(overrides: Partial<ReturnType<typeof useBrief>> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useBrief>;
}

function generateResult(overrides: Partial<ReturnType<typeof useGenerateBrief>> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useGenerateBrief>;
}

/** A deliberately non-alphabetical fixture (AC-6) — `review_focus` must render
 *  in exactly this server order, never re-sorted. */
function makeBrief(
  overrides: Partial<PrBriefRecord & { is_current: boolean }> = {},
): PrBriefRecord & { is_current: boolean } {
  return {
    pr_id: "pr-1",
    what: "Adds rate limiting to public API endpoints.",
    why: "Prevents abuse from unauthenticated clients.",
    risk_level: "medium",
    risks: [
      {
        kind: "security",
        title: "Auth surface touched",
        explanation: "Middleware sits in front of every public route.",
        severity: "high",
        file_refs: ["src/middleware/ratelimit.ts"],
      },
    ],
    review_focus: [
      { file: "src/api/users.ts", line: 46, reason: "N+1 query under the new limiter" },
      { file: "src/config.ts", line: 12, reason: "Stripe key committed in plaintext" },
    ],
    provenance: {
      head_sha: "headsha1234567",
      indexed_sha: "indexsha7654321",
      index_stale: false,
      generated_at: "2026-08-25T10:00:00.000Z",
      missing_inputs: [],
      selected_docs: [],
      dropped_docs: [],
      dropped_sections: [],
      rejected_entries: [],
      model: "gpt-test",
      provider: "openai",
      tokens_in: 8200,
      tokens_out: 1300,
      cost_usd: 0.014,
      cost_source: "exact",
      retries: 0,
    },
    is_current: true,
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof PrBriefCard>> = {},
) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages } as never}>
        <PrBriefCard prId="pr-1" repoId="repo-1" headSha="headsha1234567" {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("never-generated state offers to generate and states that it spends money (AC-51)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: null }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/spends money|calls the model and spends money/i)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: /generate brief/i });
    fireEvent.click(cta);
  });

  it("clicking generate calls the mutation", () => {
    const mutate = vi.fn();
    mockedUseBrief.mockReturnValue(queryResult({ data: null }));
    mockedUseGenerateBrief.mockReturnValue(generateResult({ mutate }));
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));
    expect(mutate).toHaveBeenCalled();
  });

  it("generating state shows an accessible role=status line and a loading button (AC-32, NFR-18)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: null }));
    mockedUseGenerateBrief.mockReturnValue(generateResult({ isPending: true }));
    renderCard();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/generating brief/i)).toBeInTheDocument();
  });

  it("failed generation reports the reason and leaves a previously stored brief rendered below it (AC-40, AC-59)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(
      generateResult({ isError: true, error: new Error("model provider unavailable") }),
    );
    renderCard();

    expect(screen.getByText(/brief could not be generated/i)).toBeInTheDocument();
    expect(screen.getByText(/model provider unavailable/i)).toBeInTheDocument();
    // The previously stored brief is still fully rendered underneath.
    expect(screen.getByText(/adds rate limiting/i)).toBeInTheDocument();
  });

  it("present state shows what/why, the risk level as a text label, risks, and review focus (AC-49…AC-53)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/adds rate limiting/i)).toBeInTheDocument();
    expect(screen.getByText(/prevents abuse/i)).toBeInTheDocument();
    // Risk level renders as a TEXT label (AC-50) distinguishable from a
    // review verdict / PR score (AC-52) — not a bare colour swatch.
    expect(screen.getByText(/medium risk/i)).toBeInTheDocument();
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText(/N\+1 query under the new limiter/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe key committed in plaintext/)).toBeInTheDocument();
    // The model-generated label (NFR-13).
    expect(screen.getByText(/model-generated/i)).toBeInTheDocument();
    // No diff content was sent (AC-42).
    expect(screen.getByText(/no diff content/i)).toBeInTheDocument();
  });

  it("review focus renders in server order, not re-sorted (AC-6)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    const reasons = screen
      .getAllByText(/N\+1 query under the new limiter|Stripe key committed in plaintext/)
      .map((el) => el.textContent);
    expect(reasons[0]).toMatch(/N\+1/);
    expect(reasons[1]).toMatch(/Stripe/);
  });

  it("cost of exactly 0 renders as a price, not as unknown (AC-9)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({ data: makeBrief({ provenance: { ...makeBrief().provenance, cost_usd: 0 } }) }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.queryByText(/cost unknown/i)).not.toBeInTheDocument();
  });

  it("a null cost renders as unknown, distinct from zero (AC-10)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({ data: makeBrief({ provenance: { ...makeBrief().provenance, cost_usd: null } }) }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/cost unknown/i)).toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("shows both input and output token counts (AC-8)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/8200 in.*1300 out|8200.*1300/)).toBeInTheDocument();
  });

  it("stale index shows the impact-describes-an-older-commit notice (AC-37)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({ data: makeBrief({ provenance: { ...makeBrief().provenance, index_stale: true } }) }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/older commit than the diff/i)).toBeInTheDocument();
  });

  it("missing inputs are stated on the brief (AC-41)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          provenance: {
            ...makeBrief().provenance,
            missing_inputs: ["derived intent was not available"],
          },
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/built without some inputs/i)).toBeInTheDocument();
    expect(screen.getByText(/derived intent was not available/i)).toBeInTheDocument();
  });

  it("a rejected entry is stated and its reason is readable (AC-24)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          provenance: {
            ...makeBrief().provenance,
            rejected_entries: [{ entry: "src/does-not-exist.ts:9", reason: "file not present in input data" }],
          },
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/at least one reference was rejected/i)).toBeInTheDocument();
    expect(screen.getByText(/file not present in input data/i)).toBeInTheDocument();
  });

  it("all references rejected still shows what/why/risk level, with an explicit rejection statement (AC-26)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          risks: [],
          review_focus: [],
          provenance: {
            ...makeBrief().provenance,
            rejected_entries: [{ entry: "x", reason: "invented" }],
          },
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/adds rate limiting/i)).toBeInTheDocument();
    expect(screen.getByText(/medium risk/i)).toBeInTheDocument();
    expect(screen.getByText(/no risk or review-focus reference survived/i)).toBeInTheDocument();
  });

  it("selected document paths are readable (AC-19)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          provenance: {
            ...makeBrief().provenance,
            selected_docs: [{ path: "docs/architecture.md", rank: 0 }],
          },
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
  });

  it("a review-focus entry with a null line renders without a line number (AC-25)", () => {
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          review_focus: [{ file: "src/unclear.ts", line: null, reason: "touches shared state" }],
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText("src/unclear.ts")).toBeInTheDocument();
    expect(screen.queryByText(/src\/unclear\.ts:/)).not.toBeInTheDocument();
  });

  it("clicking an in-PR review-focus entry navigates via onGoToLocation pinned to head (AC-43, AC-45)", () => {
    const onGoToLocation = vi.fn();
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard({ onGoToLocation });

    fireEvent.click(screen.getByRole("button", { name: /src\/api\/users\.ts:46/ }));

    // sha is null and pin is "head": the host resolves the destination purely
    // from the PR's OWN head sha, never from an index sha — even when
    // indexed_sha differs from head_sha, as this fixture deliberately sets up.
    expect(onGoToLocation).toHaveBeenCalledWith("src/api/users.ts", 46, null, "head");
  });

  it("clicking an out-of-PR review-focus entry also navigates via onGoToLocation, pinned to head (AC-44, AC-45)", () => {
    const onGoToLocation = vi.fn();
    mockedUseBrief.mockReturnValue(
      queryResult({
        data: makeBrief({
          review_focus: [{ file: "src/unrelated/outside.ts", line: 3, reason: "referenced but not in this PR" }],
        }),
      }),
    );
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard({ onGoToLocation });

    fireEvent.click(screen.getByRole("button", { name: /src\/unrelated\/outside\.ts:3/ }));
    expect(onGoToLocation).toHaveBeenCalledWith("src/unrelated/outside.ts", 3, null, "head");
  });

  it("clicking the same review-focus entry twice navigates twice (AC-48)", () => {
    const onGoToLocation = vi.fn();
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard({ onGoToLocation });

    const button = screen.getByRole("button", { name: /src\/api\/users\.ts:46/ });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onGoToLocation).toHaveBeenCalledTimes(2);
  });

  it("a review-focus entry is inert (not a button) without onGoToLocation (AC-47)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief() }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/src\/api\/users\.ts:46/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /src\/api\/users\.ts:46/ })).not.toBeInTheDocument();
  });

  // 0003 — Why Timeline: `is_current` was always computed server-side but
  // never rendered, so a stale brief looked identical to a current one.
  it("a non-current brief shows the stale notice (AC-30, the is_current gap)", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief({ is_current: false }) }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.getByText(/earlier commit or index than the pr's current state/i)).toBeInTheDocument();
  });

  it("a current brief does not show the stale notice", () => {
    mockedUseBrief.mockReturnValue(queryResult({ data: makeBrief({ is_current: true }) }));
    mockedUseGenerateBrief.mockReturnValue(generateResult());
    renderCard();

    expect(screen.queryByText(/earlier commit or index than the pr's current state/i)).not.toBeInTheDocument();
  });
});
