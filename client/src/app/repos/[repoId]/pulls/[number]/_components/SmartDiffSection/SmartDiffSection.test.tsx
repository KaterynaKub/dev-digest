import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { SmartDiffSection } from "./SmartDiffSection";
import { useSmartDiff } from "@/lib/hooks/reviews";

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: vi.fn(),
}));

afterEach(cleanup);

const mockedUseSmartDiff = vi.mocked(useSmartDiff);

function queryResult(overrides: Partial<ReturnType<typeof useSmartDiff>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof useSmartDiff>;
}

function makeFile(path: string, patch = "@@ -1,1 +1,1 @@\n-old\n+new"): PrFile {
  return { path, additions: 1, deletions: 1, patch };
}

function makeSmartDiff(overrides: Partial<SmartDiff> = {}): SmartDiff {
  return {
    groups: [
      { role: "core", files: [] },
      { role: "wiring", files: [] },
      { role: "boilerplate", files: [] },
    ],
    split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    ...overrides,
  };
}

function renderSection(props: Partial<React.ComponentProps<typeof SmartDiffSection>> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <SmartDiffSection
          prId="pr-1"
          files={[]}
          order="smart"
          onOrderChange={() => {}}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SmartDiffSection", () => {
  it("loading state shows a role=status line", () => {
    mockedUseSmartDiff.mockReturnValue(queryResult({ isLoading: true }));
    renderSection();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders all three group headers, including a zero-file group, and keeps boilerplate collapsed while core/wiring stay open", () => {
    const coreFile = makeFile("src/core.ts");
    const wiringFile = makeFile("src/wiring.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            { role: "core", files: [{ path: "src/core.ts", additions: 1, deletions: 1, finding_lines: [], finding_count: 0 }] },
            { role: "wiring", files: [{ path: "src/wiring.ts", additions: 1, deletions: 1, finding_lines: [], finding_count: 0 }] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [coreFile, wiringFile] });

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();

    const groupHeaders = screen.getAllByRole("button", { name: /Core|Wiring|Boilerplate/ });
    const coreHeader = groupHeaders.find((el) => el.textContent?.includes("Core"));
    const wiringHeader = groupHeaders.find((el) => el.textContent?.includes("Wiring"));
    const boilerplateHeader = groupHeaders.find((el) => el.textContent?.includes("Boilerplate"));
    expect(coreHeader).toHaveAttribute("aria-expanded", "true");
    expect(wiringHeader).toHaveAttribute("aria-expanded", "true");
    expect(boilerplateHeader).toHaveAttribute("aria-expanded", "false");

    // An open group with zero files shows the muted "empty group" line.
    expect(screen.queryByText("No files in this group.")).not.toBeInTheDocument();
  });

  it("boilerplate stays collapsed even when it is the only non-empty group", () => {
    const file = makeFile("scripts/gen.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            { role: "core", files: [] },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [{ path: "scripts/gen.ts", additions: 2, deletions: 0, finding_lines: [], finding_count: 0 }] },
          ],
        }),
      }),
    );
    renderSection({ files: [file] });

    const boilerplateHeader = screen.getAllByRole("button").find((el) => el.textContent?.includes("Boilerplate"));
    expect(boilerplateHeader).toHaveAttribute("aria-expanded", "false");
    // The file inside stays hidden — its path is not rendered while collapsed.
    expect(screen.queryByText("scripts/gen.ts")).not.toBeInTheDocument();
  });

  it("inside an open group, a file with findings is expanded and one without is not", () => {
    const withFindings = makeFile("src/a.ts");
    const withoutFindings = makeFile("src/b.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                { path: "src/a.ts", additions: 1, deletions: 1, finding_lines: [3], finding_count: 1, finding_marks: [{ line: 1, severity: "WARNING", finding_id: "f1", review_id: "r1" }] },
                { path: "src/b.ts", additions: 1, deletions: 1, finding_lines: [], finding_count: 0 },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [withFindings, withoutFindings] });

    const fileHeaders = screen.getAllByRole("button").filter((el) => el.className === "" || el.getAttribute("aria-expanded") != null);
    const aHeader = fileHeaders.find((el) => el.textContent?.includes("src/a.ts"));
    const bHeader = fileHeaders.find((el) => el.textContent?.includes("src/b.ts"));
    expect(aHeader).toHaveAttribute("aria-expanded", "true");
    expect(bHeader).toHaveAttribute("aria-expanded", "false");
  });

  it("a CRITICAL mark renders 'blocker', not 'critical'", () => {
    const file = makeFile("src/a.ts", "@@ -1,1 +1,1 @@\n-old\n+new line");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 1,
                  deletions: 1,
                  finding_lines: [1],
                  finding_count: 1,
                  finding_marks: [{ line: 1, severity: "CRITICAL", finding_id: "f1", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [file] });

    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
  });

  it("is_large renders the Large badge; a normal file does not", () => {
    const large = makeFile("src/big.ts");
    const normal = makeFile("src/small.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                { path: "src/big.ts", additions: 400, deletions: 0, finding_lines: [], finding_count: 0, is_large: true },
                { path: "src/small.ts", additions: 2, deletions: 0, finding_lines: [], finding_count: 0, is_large: false },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [large, normal] });

    expect(screen.getByText("Large")).toBeInTheDocument();
  });

  it("clicking Original order flips aria-pressed", () => {
    mockedUseSmartDiff.mockReturnValue(queryResult({ data: makeSmartDiff() }));
    const onOrderChange = vi.fn();
    renderSection({ order: "smart", onOrderChange });

    const smartBtn = screen.getByRole("button", { name: "Smart order" });
    const originalBtn = screen.getByRole("button", { name: "Original order" });
    expect(smartBtn).toHaveAttribute("aria-pressed", "true");
    expect(originalBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(originalBtn);
    expect(onOrderChange).toHaveBeenCalledWith("original");
  });

  it("never renders a 'What this does' block or a summary badge, even when pseudocode_summary is set", () => {
    const file = makeFile("src/a.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 1,
                  deletions: 1,
                  finding_lines: [],
                  finding_count: 0,
                  pseudocode_summary: "This adds a new helper that formats dates.",
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [file] });

    expect(screen.queryByText(/What this does/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/formats dates/i)).not.toBeInTheDocument();
    expect(screen.queryByText("summary")).not.toBeInTheDocument();
  });

  it("error state renders smartDiff.error", () => {
    mockedUseSmartDiff.mockReturnValue(queryResult({ isError: true }));
    renderSection();
    expect(screen.getByText("Couldn't load the reviewer-ordered diff.")).toBeInTheDocument();
  });

  it("clicking a mark badge calls onGoToFinding with that mark's finding_id; without the prop the badge renders as plain text", () => {
    const file = makeFile("src/a.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 1,
                  deletions: 1,
                  finding_lines: [1],
                  finding_count: 1,
                  finding_marks: [{ line: 1, severity: "CRITICAL", finding_id: "f-target", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );

    // No onGoToFinding: the badge is plain text, no button role for it.
    const { unmount } = renderSection({ files: [file] });
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to this/i })).not.toBeInTheDocument();
    unmount();

    // With onGoToFinding: clicking the badge navigates with that mark's finding_id.
    const onGoToFinding = vi.fn();
    renderSection({ files: [file], onGoToFinding });
    const badgeButton = screen.getByRole("button", { name: "Go to this blocker finding" });
    fireEvent.click(badgeButton);
    expect(onGoToFinding).toHaveBeenCalledWith("f-target");

    // No popup, no modal, no new tab, no github.com on this path.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="github.com"]')).not.toBeInTheDocument();
  });
});
