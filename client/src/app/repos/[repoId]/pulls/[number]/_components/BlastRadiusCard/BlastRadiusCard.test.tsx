import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import { BlastRadiusCard } from "./BlastRadiusCard";
import { useBlast } from "@/lib/hooks/reviews";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { useDirtyContextDocs } from "@/lib/hooks/project-context";

vi.mock("@/lib/hooks/reviews", () => ({
  useBlast: vi.fn(),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: vi.fn(),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useDirtyContextDocs: vi.fn(),
}));

afterEach(cleanup);

const mockedUseBlast = vi.mocked(useBlast);
const mockedUseResync = vi.mocked(useResyncRepoIntel);
const mockedUseDirty = vi.mocked(useDirtyContextDocs);

/** No uncommitted project-context edits — the default for every existing test. */
function dirtyResult(paths: string[] = []) {
  return { data: { paths } } as unknown as ReturnType<typeof useDirtyContextDocs>;
}

function queryResult(overrides: Partial<ReturnType<typeof useBlast>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useBlast>;
}

function resyncResult(overrides: Partial<ReturnType<typeof useResyncRepoIntel>> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useResyncRepoIntel>;
}

function makeBlastRadius(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [{ name: "foo", file: "a.ts", kind: "function" }],
    downstream: [
      {
        symbol: "foo",
        callers: [{ name: "caller", file: "b.ts", line: 10 }],
        endpoints_affected: ["GET /api/x"],
        crons_affected: [],
      },
    ],
    summary: "1 changed symbol · 1 caller across 1 file · 1 endpoint",
    index_status: "full",
    degraded: false,
    reason: null,
    indexed_sha: "abc1234def",
    index_stale: false,
    ...overrides,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof BlastRadiusCard>> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages, context: contextMessages }}>
        <BlastRadiusCard prId="pr-1" repoId="repo-1" {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  // Default: a clean clone. The resync-confirmation tests override this.
  beforeEach(() => {
    mockedUseDirty.mockReturnValue(dirtyResult([]));
  });

  it("loading state shows an accessible role=status line", () => {
    mockedUseBlast.mockReturnValue(queryResult({ isLoading: true }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("error state shows a retry action that calls refetch", () => {
    const refetch = vi.fn();
    mockedUseBlast.mockReturnValue(queryResult({ isError: true, refetch }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalled();
  });

  it("renders stats and expands a symbol to reveal its callers and endpoint badges", () => {
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    // Caller row is collapsed by default.
    expect(screen.queryByText(/b\.ts:10/)).not.toBeInTheDocument();

    const symbolHeader = screen.getByText("foo()");
    fireEvent.click(symbolHeader);

    expect(screen.getByText(/b\.ts:10/)).toBeInTheDocument();
    expect(screen.getByText("GET /api/x")).toBeInTheDocument();
  });

  it("full index + empty downstream shows the plain 'no callers' fact, not a degraded banner", () => {
    mockedUseBlast.mockReturnValue(
      queryResult({ data: makeBlastRadius({ downstream: [], summary: "no downstream" }) }),
    );
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    expect(screen.getByText(/no downstream callers found/i)).toBeInTheDocument();
    expect(screen.queryByText(/index not built/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/index is partial/i)).not.toBeInTheDocument();
  });

  it("switches between tree and graph view on toggle click, and the graph button is not disabled", () => {
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    const graphButton = screen.getByRole("button", { name: "graph" });
    expect(graphButton).not.toBeDisabled();

    // Tree view renders the collapsible symbol row by default.
    expect(screen.getByText("foo()")).toBeInTheDocument();

    fireEvent.click(graphButton);

    // Graph view renders the accessible svg instead of the tree.
    expect(screen.queryByText("foo()")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getByText("foo()")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("clicking a caller's file:line calls onGoToLocation with that file and line", () => {
    const onGoToLocation = vi.fn();
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard({ onGoToLocation });

    fireEvent.click(screen.getByText("foo()"));
    const locationButton = screen.getByRole("button", { name: "Open b.ts at line 10" });
    fireEvent.click(locationButton);

    // The sha travels with the coordinates: a line number is only meaningful
    // against the commit the indexer recorded it in.
    expect(onGoToLocation).toHaveBeenCalledWith("b.ts", 10, "abc1234def");
    // The card decides nothing about WHERE this opens — no tab, no URL, and in
    // particular no github.com link of its own (the host owns that choice).
    expect(document.querySelector('a[href*="github.com"]')).not.toBeInTheDocument();
  });

  it("without onGoToLocation the file:line stays plain text, not a button", () => {
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    fireEvent.click(screen.getByText("foo()"));
    expect(screen.getByText(/b\.ts:10/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open b\.ts/i })).not.toBeInTheDocument();
  });

  it("a stale index shows the staleness notice and its short sha, while staying non-degraded", () => {
    mockedUseBlast.mockReturnValue(
      queryResult({
        data: makeBlastRadius({ index_stale: true, indexed_sha: "abc1234def5678" }),
      }),
    );
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();

    expect(screen.getByText(/built from an earlier commit/i)).toBeInTheDocument();
    expect(screen.getByText(/abc1234/)).toBeInTheDocument();
    // Stale is NOT degraded — the "index not built" wording must stay absent,
    // and the real counts are still shown rather than suppressed.
    expect(screen.queryByText(/index not built/i)).not.toBeInTheDocument();
    expect(screen.getByText(/foo\(\)/)).toBeInTheDocument();
  });

  it("a current index shows no staleness notice", () => {
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult());
    renderCard();
    expect(screen.queryByText(/built from an earlier commit/i)).not.toBeInTheDocument();
  });

  // The reindex action used to live only inside the degraded banner, so a
  // healthy-but-stale index offered no way to fix itself from this card.
  it("offers reindex on a healthy index, not only when degraded", () => {
    const mutate = vi.fn();
    mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
    mockedUseResync.mockReturnValue(resyncResult({ mutate }));
    renderCard();

    const resyncButton = screen.getByRole("button", { name: /resync/i });
    fireEvent.click(resyncButton);
    expect(mutate).toHaveBeenCalled();
  });

  it("degraded index shows the index-state banner (never 'no downstream callers found') with a resync action", () => {
    const mutate = vi.fn();
    mockedUseBlast.mockReturnValue(
      queryResult({
        data: makeBlastRadius({
          downstream: [],
          index_status: "degraded",
          degraded: true,
          reason: "no_data",
          summary: "Index not built — downstream unavailable.",
        }),
      }),
    );
    mockedUseResync.mockReturnValue(resyncResult({ mutate }));
    renderCard();

    expect(screen.getByText(/index not built/i)).toBeInTheDocument();
    expect(screen.queryByText(/no downstream callers found/i)).not.toBeInTheDocument();

    const resyncButton = screen.getByRole("button", { name: /resync/i });
    fireEvent.click(resyncButton);
    expect(mutate).toHaveBeenCalled();
  });

  /* AC-22/AC-53 — `sync()` is `git reset --hard`, so a re-index destroys
     uncommitted edits to project-context documents. The user must be warned
     with the affected paths, and the mutation must NOT fire until they say so. */
  describe("uncommitted project-context edits block the re-index until confirmed", () => {
    it("does not call resync on click — it opens a confirmation naming the documents at risk", () => {
      const mutate = vi.fn();
      mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
      mockedUseResync.mockReturnValue(resyncResult({ mutate }));
      mockedUseDirty.mockReturnValue(dirtyResult(["specs/api.md", "docs/arch.md"]));
      renderCard();

      fireEvent.click(screen.getByRole("button", { name: /resync/i }));

      // The whole point of AC-53: nothing has been destroyed yet.
      expect(mutate).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("specs/api.md")).toBeInTheDocument();
      expect(screen.getByText("docs/arch.md")).toBeInTheDocument();
    });

    it("calls resync once the user confirms", () => {
      const mutate = vi.fn();
      mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
      mockedUseResync.mockReturnValue(resyncResult({ mutate }));
      mockedUseDirty.mockReturnValue(dirtyResult(["specs/api.md"]));
      renderCard();

      fireEvent.click(screen.getByRole("button", { name: /resync/i }));
      fireEvent.click(screen.getByRole("button", { name: /re-index and discard/i }));

      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it("cancelling leaves the clone untouched", () => {
      const mutate = vi.fn();
      mockedUseBlast.mockReturnValue(queryResult({ data: makeBlastRadius() }));
      mockedUseResync.mockReturnValue(resyncResult({ mutate }));
      mockedUseDirty.mockReturnValue(dirtyResult(["specs/api.md"]));
      renderCard();

      fireEvent.click(screen.getByRole("button", { name: /resync/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(mutate).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
