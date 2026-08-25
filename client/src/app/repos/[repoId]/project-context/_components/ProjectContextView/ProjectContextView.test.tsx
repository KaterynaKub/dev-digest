import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocContent } from "@/lib/hooks/project-context";
import type { ContextListing } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";
import commonMessages from "../../../../../../../messages/en/common.json";
import { ToastProvider } from "../../../../../../lib/toast";

// Every top-level *View pulls in AppShell → useRouter/usePathname; mocking
// only one of the two still throws "invariant expected app router to be
// mounted" (client/INSIGHTS.md).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ repoId: "repo1" }),
}));

const activeRepoState: { activeRepo: { id: string; full_name: string } | null } = {
  activeRepo: { id: "repo1", full_name: "acme/payments-api" },
};
const repoNotFoundState = { value: false };

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: activeRepoState.activeRepo }),
  useRepoNotFound: () => repoNotFoundState.value,
}));

const listingState: { data: ContextListing | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const docContentState: { data: ContextDocContent | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const saveMutate = vi.fn();

vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => ({ ...listingState, refetch: vi.fn() }),
  useContextDoc: () => docContentState,
  useSaveContextDoc: () => ({ mutate: saveMutate, isPending: false, isError: false }),
}));

import { ProjectContextView } from "./ProjectContextView";

function LISTING(o: Partial<ContextListing["status"]> & { docs?: ContextListing["docs"] } = {}): ContextListing {
  const { docs, ...statusOverrides } = o;
  return {
    docs: docs ?? [
      { path: "specs/public-api.md", attached_count: 3, root: "specs/" },
      { path: "docs/architecture.md", attached_count: 0, root: "docs/" },
    ],
    status: {
      count: 2,
      token_sum: 900,
      token_sum_pending: false,
      scanned_at: new Date().toISOString(),
      truncated: false,
      fallback_used: false,
      cloned: true,
      ...statusOverrides,
    },
  };
}

afterEach(() => {
  cleanup();
  listingState.data = undefined;
  listingState.isLoading = false;
  listingState.isError = false;
  docContentState.data = undefined;
  docContentState.isLoading = false;
  docContentState.isError = false;
  repoNotFoundState.value = false;
  saveMutate.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages, common: commonMessages }}>
      <ToastProvider>
        <ProjectContextView repoId="repo1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("shows the repo-not-found empty state for a stale :repoId", () => {
    repoNotFoundState.value = true;
    renderWithIntl();
    expect(screen.getByText("No repo selected")).toBeInTheDocument();
  });

  it("shows a full-screen error state on a listing fetch failure (NFR-7) — never an empty list", () => {
    listingState.isError = true;
    renderWithIntl();
    expect(screen.getByText("Couldn’t load the repository’s content right now.")).toBeInTheDocument();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
  });

  it("shows the not-cloned state distinct from an empty listing (AC-6/AC-63)", () => {
    listingState.data = LISTING({ cloned: false, count: undefined, token_sum: undefined, docs: [] });
    renderWithIntl();
    expect(screen.getByText("Repository not cloned yet")).toBeInTheDocument();
    expect(screen.getByText("Repository not cloned")).toBeInTheDocument();
  });

  it("shows the empty state naming the searched roots when nothing matched (AC-5)", () => {
    listingState.data = LISTING({ docs: [], count: 0 });
    renderWithIntl();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/specs\/, docs\/, insights\//)).toBeInTheDocument();
  });

  it("states an explicit zero-token sum for an empty listing rather than omitting it (AC-62)", () => {
    listingState.data = LISTING({ docs: [], count: 0 });
    renderWithIntl();
    expect(screen.getByText(/0 documents · ≈ 0 tokens/)).toBeInTheDocument();
  });

  it("shows a pending indicator in place of the sum while it is still computing (AC-61)", () => {
    listingState.data = LISTING({ token_sum_pending: true, token_sum: null });
    renderWithIntl();
    expect(screen.getByText(/estimating tokens…/)).toBeInTheDocument();
    // The listing itself is not blocked — rows still render. The path also
    // appears in the detail header once auto-selected, hence getAllByText.
    expect(screen.getAllByText("specs/public-api.md").length).toBeGreaterThan(0);
  });

  it("renders the normal summary state with count, token sum, and scan time", () => {
    listingState.data = LISTING();
    renderWithIntl();
    expect(screen.getByText(/2 documents · ≈ 900 tokens/)).toBeInTheDocument();
  });

  it("appends a fallback-used note independent of the summary (AC-60)", () => {
    listingState.data = LISTING({ fallback_used: true });
    renderWithIntl();
    expect(screen.getByText(/character-based estimate/)).toBeInTheDocument();
  });

  it("appends a truncated note independent of the summary (NFR-19/NFR-22)", () => {
    listingState.data = LISTING({ truncated: true });
    renderWithIntl();
    expect(screen.getByText(/Listing truncated/)).toBeInTheDocument();
  });

  it("selects the first document and shows Used by N agents", () => {
    listingState.data = LISTING();
    docContentState.data = { path: "specs/public-api.md", content: "# Hello", tokens: 10, approximate: true, dirty: false };
    renderWithIntl();
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
  });

  it("renders the document preview as Markdown by default", () => {
    listingState.data = LISTING();
    docContentState.data = { path: "specs/public-api.md", content: "# Hello", tokens: 10, approximate: true, dirty: false };
    renderWithIntl();
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("shows a persistent, text-based uncommitted state (AC-21/NFR-15)", () => {
    listingState.data = LISTING();
    docContentState.data = { path: "specs/public-api.md", content: "# Hello", tokens: 10, approximate: true, dirty: true };
    renderWithIntl();
    expect(screen.getByText(/Uncommitted/)).toBeInTheDocument();
  });

  it("switches to Edit and shows a real textarea seeded with the current content", () => {
    listingState.data = LISTING();
    docContentState.data = { path: "specs/public-api.md", content: "# Hello", tokens: 10, approximate: true, dirty: false };
    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue(/^# Hello/)).toBeInTheDocument();
  });

  it("saves the edited content through useSaveContextDoc", () => {
    listingState.data = LISTING();
    docContentState.data = { path: "specs/public-api.md", content: "# Hello", tokens: 10, approximate: true, dirty: false };
    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(/^# Hello/), { target: { value: "# Hello\nEdited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveMutate).toHaveBeenCalledWith(
      { path: "specs/public-api.md", content: "# Hello\nEdited" },
      expect.anything(),
    );
  });

  it("switches documents when a different row is selected", () => {
    listingState.data = LISTING();
    renderWithIntl();
    fireEvent.click(screen.getByText("docs/architecture.md"));
    // Used-by count switches to the newly selected doc's own count (0).
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();
  });
});
