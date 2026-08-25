import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextAttachment, ContextListing } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";
import { ToastProvider } from "../../lib/toast";

vi.mock("../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo1" }),
}));

const LISTING: ContextListing = {
  docs: [
    { path: "specs/public-api.md", attached_count: 1, root: "specs/" },
    { path: "specs/rate-limiting.md", attached_count: 0, root: "specs/" },
    { path: "docs/architecture.md", attached_count: 0, root: "docs/" },
    { path: "insights/perf-budget.md", attached_count: 0, root: "insights/" },
    { path: "adr/0001-choice.md", attached_count: 0, root: "adr/" },
  ],
  status: {
    count: 5,
    token_sum: 900,
    token_sum_pending: false,
    scanned_at: new Date().toISOString(),
    truncated: false,
    fallback_used: false,
    cloned: true,
  },
};

const DEFAULT_ATTACHMENTS: ContextAttachment[] = [
  { path: "specs/public-api.md", order: 0, missing: false },
  { path: "specs/rate-limiting.md", order: 1, missing: false },
];

// Mutable per-test fixture so a boundary scenario (missing row, at-limit) can
// override the attachment set without a second `vi.mock` registration —
// `vi.mock` factories run once at collection time, not per test.
const attachState: { data: ContextAttachment[] } = { data: DEFAULT_ATTACHMENTS };

const setAgentDocsMutate = vi.fn();
const setSkillDocsMutate = vi.fn();

function docContent(path: string) {
  return { path, content: `# ${path}`, tokens: 42, approximate: true, dirty: false };
}

vi.mock("../../lib/hooks/project-context", () => ({
  useContextDocs: () => ({ data: LISTING }),
  useAgentContextDocs: () => ({ data: attachState.data }),
  useSkillContextDocs: () => ({ data: attachState.data }),
  useSetAgentContextDocs: () => ({ mutate: setAgentDocsMutate, isPending: false }),
  useSetSkillContextDocs: () => ({ mutate: setSkillDocsMutate, isPending: false }),
  useContextDoc: (_repoId: string, path: string) => ({ data: docContent(path), isLoading: false, isError: false }),
  useContextDocsSum: (_repoId: string, paths: string[]) => ({
    tokens: paths.length * 42,
    approximate: true,
    pending: false,
  }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setAgentDocsMutate.mockClear();
  setSkillDocsMutate.mockClear();
  attachState.data = DEFAULT_ATTACHMENTS;
});

function renderWithIntl(entity: "agent" | "skill" = "agent") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ToastProvider>
        <ContextTab entity={entity} id="ag1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("lists every discovered document, attached ones first and checked", () => {
    renderWithIntl();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "specs/public-api.md",
      "specs/rate-limiting.md",
      "docs/architecture.md",
      "insights/perf-budget.md",
      "adr/0001-choice.md",
    ]);
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "false", "false", "false"]);
  });

  it("shows the attached-vs-discovered count", () => {
    renderWithIntl();
    expect(screen.getByText("2 of 5 attached")).toBeInTheDocument();
  });

  it("renders a fixed-color type badge from the matched root", () => {
    renderWithIntl();
    expect(screen.getAllByText("specs").length).toBeGreaterThan(0);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();
  });

  it("renders a neutral badge for a custom root outside the known palette", () => {
    renderWithIntl();
    expect(screen.getByText("adr")).toBeInTheDocument();
  });

  it("checking an unattached document saves the full set immediately", () => {
    renderWithIntl();
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/architecture.md" }));
    expect(setAgentDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/public-api.md", "specs/rate-limiting.md", "docs/architecture.md"],
    });
  });

  it("unchecking an attached document detaches it and saves", () => {
    renderWithIntl();
    fireEvent.click(screen.getByRole("checkbox", { name: "specs/rate-limiting.md" }));
    expect(setAgentDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/public-api.md"],
    });
  });

  it("moving an attached row up saves the new order", () => {
    renderWithIntl();
    fireEvent.click(screen.getByLabelText("Move specs/rate-limiting.md up"));
    expect(setAgentDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/rate-limiting.md", "specs/public-api.md"],
    });
  });

  it("the up arrow is disabled on the first attached row and down on the last", () => {
    renderWithIntl();
    expect(screen.getByLabelText("Move specs/public-api.md up")).toBeDisabled();
    expect(screen.getByLabelText("Move specs/rate-limiting.md down")).toBeDisabled();
  });

  it("an unattached document has no reorder controls", () => {
    renderWithIntl();
    expect(screen.queryByLabelText("Move docs/architecture.md up")).not.toBeInTheDocument();
  });

  it("dragging a row onto an earlier one reorders and saves", () => {
    renderWithIntl();
    // Attached rows are index 0 and 1 in DOM order.
    const boxes = screen.getAllByRole("checkbox");
    const first = boxes[0]!.parentElement as HTMLElement;
    const second = boxes[1]!.parentElement as HTMLElement;
    fireEvent.dragStart(second);
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    expect(setAgentDocsMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/rate-limiting.md", "specs/public-api.md"],
    });
  });

  it("filtering narrows the list without touching the attached set", () => {
    renderWithIntl();
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "architecture" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(setAgentDocsMutate).not.toHaveBeenCalled();
  });

  it("shows a missing tag without unchecking the row (AC-37)", () => {
    attachState.data = [{ path: "specs/gone.md", order: 0, missing: true }];
    renderWithIntl();
    const box = screen.getByRole("checkbox", { name: "specs/gone.md" });
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("missing")).toBeInTheDocument();
  });

  it("shows the summed token estimate with an approximation marker", () => {
    renderWithIntl();
    expect(screen.getByText(/84 tokens/)).toBeInTheDocument();
  });

  it("opens a preview drawer for a row", () => {
    renderWithIntl();
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]!);
    // The stubbed doc content is `# specs/public-api.md` — rendered by the
    // real Markdown primitive as an <h1>, not shown as literal `#` text.
    expect(screen.getByRole("heading", { name: "specs/public-api.md" })).toBeInTheDocument();
  });

  it("rejects a 21st attachment with a limit toast and does not save", () => {
    attachState.data = Array.from({ length: 20 }, (_, i) => ({
      path: `specs/doc-${i}.md`,
      order: i,
      missing: false,
    }));
    renderWithIntl();
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/architecture.md" }));
    expect(screen.getByText(/Up to 20 documents can be attached/)).toBeInTheDocument();
    expect(setAgentDocsMutate).not.toHaveBeenCalled();
  });

  it("saves through the skill mutation when entity is skill", () => {
    renderWithIntl("skill");
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/architecture.md" }));
    expect(setSkillDocsMutate).toHaveBeenCalledWith({
      skillId: "ag1",
      paths: ["specs/public-api.md", "specs/rate-limiting.md", "docs/architecture.md"],
    });
    expect(setAgentDocsMutate).not.toHaveBeenCalled();
  });
});
