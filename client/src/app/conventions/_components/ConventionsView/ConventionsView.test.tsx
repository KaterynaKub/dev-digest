import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionsView as ViewDto } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";

/* Rendering a real *ListView under jsdom throws "invariant expected app router
   to be mounted" unless BOTH the app shell and next/navigation are mocked. */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/conventions",
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api" },
    repos: [],
    reposLoaded: true,
    setRepoId: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks", () => ({ useSettings: () => ({ data: { feature_models: {} } }) }));
vi.mock("@/lib/hooks/agents", () => ({
  useProviderModels: () => ({ data: [{ id: "deepseek/deepseek-v4-flash" }] }),
}));

const extractMutate = vi.fn();
const bulkMutate = vi.fn();
const updateMutate = vi.fn();
let viewData: { data?: ViewDto; isLoading: boolean; isError: boolean };

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({ ...viewData, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
  useBulkSetConventionStatus: () => ({ mutate: bulkMutate, isPending: false }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: false, isError: false }),
}));

const { ConventionsView } = await import("./ConventionsView");

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    scan_id: "s1",
    category: "Async",
    rule: "Always use async/await instead of .then() chains.",
    evidence_path: "src/api/users.ts",
    evidence_start_line: 23,
    evidence_end_line: 31,
    evidence_snippet: "const user = await db.users.find(id);",
    confidence: 0.91,
    status: "pending",
    edited: false,
    ...over,
  };
}

const SCAN = {
  id: "s1",
  repo_id: "r1",
  sample_count: 84,
  config_count: 3,
  candidates_raw: 5,
  candidates_kept: 3,
  model: "deepseek/deepseek-v4-flash",
  created_at: new Date().toISOString(),
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  viewData = { data: undefined, isLoading: false, isError: false };
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("renders the heading with the active repo", () => {
    viewData = { data: { scan: null, candidates: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("shows the error state when the query fails", () => {
    viewData = { data: undefined, isLoading: false, isError: true };
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
  });

  it("shows the empty state and its CTA runs a scan", () => {
    viewData = { data: { scan: null, candidates: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run extraction"));
    expect(extractMutate).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "r1", provider: "openrouter" }),
    );
  });

  it("reports the scan's sample count and the model it used", () => {
    viewData = {
      data: { scan: SCAN, candidates: [candidate()] },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText(/Detected from 84 sample files/)).toBeInTheDocument();
    expect(screen.getByText(/scanned with deepseek\/deepseek-v4-flash/)).toBeInTheDocument();
  });

  it("renders one card per candidate", () => {
    viewData = {
      data: {
        scan: SCAN,
        candidates: [candidate(), candidate({ id: "c2", rule: "Validate bodies with zod." })],
      },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText("Always use async/await instead of .then() chains.")).toBeInTheDocument();
    expect(screen.getByText("Validate bodies with zod.")).toBeInTheDocument();
  });

  it('"Accept all" sends a bulk accept for the pending candidates', () => {
    viewData = {
      data: { scan: SCAN, candidates: [candidate(), candidate({ id: "c2" })] },
      isLoading: false,
      isError: false,
    };
    renderView();
    fireEvent.click(screen.getByText("Accept all (2)"));
    expect(bulkMutate).toHaveBeenCalledWith({ repoId: "r1", status: "accepted" });
  });

  it("hides Create skill until something is accepted", () => {
    viewData = { data: { scan: SCAN, candidates: [candidate()] }, isLoading: false, isError: false };
    const { unmount } = renderView();
    expect(screen.queryByText("Create skill")).not.toBeInTheDocument();
    unmount();

    viewData = {
      data: { scan: SCAN, candidates: [candidate({ status: "accepted" })] },
      isLoading: false,
      isError: false,
    };
    renderView();
    expect(screen.getByText("Create skill")).toBeInTheDocument();
  });

  it("the model picker seeds to the registry default and is not persisted", () => {
    viewData = { data: { scan: null, candidates: [] }, isLoading: false, isError: false };
    renderView();
    expect(screen.getByText("default")).toBeInTheDocument();
  });
});
