import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
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

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "CRITICAL",
    category: "security",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "Because.",
    confidence: 0.9,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  } as FindingRecord;
}

/** The row element for `path`:`line` — rows covered by a finding carry an id. */
function rowFor(path: string, line: number): HTMLElement {
  const el = document.getElementById(`sd-${path}-${line}`);
  if (!el) throw new Error(`no row rendered for ${path}:${line}`);
  return el;
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

  it("a marked row is tinted across the whole row, keeps its add/del colour, and brightens on hover", () => {
    const file = makeFile("src/a.ts", "@@ -1,2 +1,2 @@\n+marked\n+plain");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 2,
                  deletions: 0,
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

    const markedRow = document.querySelector("#sd-src\\/a\\.ts-1") as HTMLElement;
    expect(markedRow).toBeInTheDocument();

    // The tint covers the row, not just the badge — and it is layered as
    // background-image so the row's own `--code-add` survives underneath.
    expect(markedRow.style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    expect(markedRow.style.background).toContain("var(--code-add)");

    // The unmarked sibling `+` row gets no tint at all.
    const plainRow = screen.getByText("plain").closest("div") as HTMLElement;
    expect(plainRow.style.backgroundImage).toBe("");

    // Hover brightens the same hue rather than switching colour.
    fireEvent.mouseEnter(markedRow);
    expect(markedRow.style.backgroundImage).toContain("rgba(239, 68, 68, 0.24)");
    fireEvent.mouseLeave(markedRow);
    expect(markedRow.style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
  });

  it("a finding's whole block is tinted, and the badge appears once at its start", () => {
    // A 5-line patch; the finding spans lines 2..4.
    const file = makeFile("src/a.ts", "@@ -1,5 +1,5 @@\n+one\n+two\n+three\n+four\n+five");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 5,
                  deletions: 0,
                  finding_lines: [2],
                  finding_count: 1,
                  finding_marks: [{ line: 2, severity: "CRITICAL", finding_id: "f1", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [file], findings: [makeFinding({ id: "f1", start_line: 2, end_line: 4 })] });

    // Lines 2, 3 and 4 are all tinted — the block, not just its first line.
    for (const line of [2, 3, 4]) {
      const row = rowFor("src/a.ts", line);
      expect(row.style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    }
    // Lines 1 and 5 sit outside the block and stay untinted.
    expect(screen.getByText("one").closest("div")!.style.backgroundImage).toBe("");
    expect(screen.getByText("five").closest("div")!.style.backgroundImage).toBe("");

    // Exactly one badge for the block, on its first row.
    expect(screen.getAllByText("blocker")).toHaveLength(1);
    expect(rowFor("src/a.ts", 2).textContent).toContain("blocker");
    expect(rowFor("src/a.ts", 3).textContent).not.toContain("blocker");
  });

  it("overlapping findings: the row takes the worst severity's tint and each block badges at its own start", () => {
    // CRITICAL spans 1..4; WARNING nests inside it at 2..3.
    const file = makeFile("src/a.ts", "@@ -1,4 +1,4 @@\n+one\n+two\n+three\n+four");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1, 2],
                  finding_count: 2,
                  finding_marks: [
                    { line: 1, severity: "CRITICAL", finding_id: "f-crit", review_id: "r1" },
                    { line: 2, severity: "WARNING", finding_id: "f-warn", review_id: "r1" },
                  ],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({
      files: [file],
      findings: [
        makeFinding({ id: "f-crit", severity: "CRITICAL", start_line: 1, end_line: 4 }),
        makeFinding({ id: "f-warn", severity: "WARNING", start_line: 2, end_line: 3 }),
      ],
    });

    // Every row of the union keeps the CRITICAL tint — the nested WARNING does
    // not punch a lighter hole through the middle of the blocker's block.
    for (const line of [1, 2, 3, 4]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    }
    expect(rowFor("src/a.ts", 2).style.backgroundImage).not.toContain("245, 158, 11");

    // Both findings are still discoverable: each badges on its own first row.
    expect(rowFor("src/a.ts", 1).textContent).toContain("blocker");
    expect(rowFor("src/a.ts", 2).textContent).toContain("warning");
    expect(screen.getAllByText("blocker")).toHaveLength(1);
    expect(screen.getAllByText("warning")).toHaveLength(1);
  });

  it("a mark whose finding is not loaded degrades to a single-line highlight", () => {
    const file = makeFile("src/a.ts", "@@ -1,3 +1,3 @@\n+one\n+two\n+three");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 3,
                  deletions: 0,
                  finding_lines: [1],
                  finding_count: 1,
                  finding_marks: [{ line: 1, severity: "CRITICAL", finding_id: "f-missing", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    // findings omitted entirely — nothing to join against.
    renderSection({ files: [file] });

    expect(rowFor("src/a.ts", 1).style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    expect(screen.getByText("two").closest("div")!.style.backgroundImage).toBe("");
    expect(screen.getByText("blocker")).toBeInTheDocument();
  });

  it("hovering one row of a finding highlights every row of that finding", () => {
    const file = makeFile("src/a.ts", "@@ -1,5 +1,5 @@\n+one\n+two\n+three\n+four\n+five");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 5,
                  deletions: 0,
                  finding_lines: [2],
                  finding_count: 1,
                  finding_marks: [{ line: 2, severity: "CRITICAL", finding_id: "f1", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [file], findings: [makeFinding({ id: "f1", start_line: 2, end_line: 4 })] });

    // Hover the MIDDLE row of the block…
    fireEvent.mouseEnter(rowFor("src/a.ts", 3));

    // …and all three rows brighten together, not just the one under the pointer.
    for (const line of [2, 3, 4]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(239, 68, 68, 0.24)");
    }

    fireEvent.mouseLeave(rowFor("src/a.ts", 3));
    for (const line of [2, 3, 4]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    }
  });

  it("hovering a nested finding's badge highlights that finding's span in its OWN severity", () => {
    // CRITICAL 1..4 with a WARNING nested at 2..3.
    const file = makeFile("src/a.ts", "@@ -1,4 +1,4 @@\n+one\n+two\n+three\n+four");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1, 2],
                  finding_count: 2,
                  finding_marks: [
                    { line: 1, severity: "CRITICAL", finding_id: "f-crit", review_id: "r1" },
                    { line: 2, severity: "WARNING", finding_id: "f-warn", review_id: "r1" },
                  ],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({
      files: [file],
      onGoToFinding: () => {},
      findings: [
        makeFinding({ id: "f-crit", severity: "CRITICAL", start_line: 1, end_line: 4 }),
        makeFinding({ id: "f-warn", severity: "WARNING", start_line: 2, end_line: 3 }),
      ],
    });

    // Hover the WARNING badge (it sits on line 2, inside the CRITICAL block).
    const warnBadge = screen.getByRole("button", { name: /Go to this warning/ }).parentElement!;
    fireEvent.mouseEnter(warnBadge);

    // Its own two rows light up in AMBER — the hovered finding's colour, not the
    // enclosing blocker's red, so it is clear which finding is being traced.
    for (const line of [2, 3]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(245, 158, 11, 0.24)");
    }
    // Rows belonging only to the CRITICAL keep their own unhovered red.
    for (const line of [1, 4]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    }
  });

  it("on a row covered by two findings, hover traces the one that STARTS LATER", () => {
    // CRITICAL 1..4 encloses a SUGGESTION 3..4. Row 3 is covered by both, and
    // the suggestion is the one that starts later.
    const file = makeFile("src/a.ts", "@@ -1,4 +1,4 @@\n+one\n+two\n+three\n+four");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1, 3],
                  finding_count: 2,
                  finding_marks: [
                    { line: 1, severity: "CRITICAL", finding_id: "f-outer", review_id: "r1" },
                    { line: 3, severity: "SUGGESTION", finding_id: "f-inner", review_id: "r1" },
                  ],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({
      files: [file],
      findings: [
        makeFinding({ id: "f-outer", severity: "CRITICAL", start_line: 1, end_line: 4 }),
        makeFinding({ id: "f-inner", severity: "SUGGESTION", start_line: 3, end_line: 4 }),
      ],
    });

    // Hover row 3 — covered by both. The later-starting SUGGESTION wins, so the
    // highlight is BLUE, not the enclosing blocker's red, even though CRITICAL
    // is the worse severity and owns the row's resting tint.
    fireEvent.mouseEnter(rowFor("src/a.ts", 3));

    for (const line of [3, 4]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(59, 130, 246, 0.24)");
    }
    // Rows 1–2 are outside the inner finding and stay at rest in red.
    for (const line of [1, 2]) {
      expect(rowFor("src/a.ts", line).style.backgroundImage).toContain("rgba(239, 68, 68, 0.13)");
    }
  });

  it("block boundaries are ruled so overlapping findings stay distinguishable", () => {
    // Two same-severity findings that touch: 1..2 and 3..4. Tint alone would
    // merge them into one indistinguishable band.
    const file = makeFile("src/a.ts", "@@ -1,4 +1,4 @@\n+one\n+two\n+three\n+four");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1, 3],
                  finding_count: 2,
                  finding_marks: [
                    { line: 1, severity: "CRITICAL", finding_id: "f-a", review_id: "r1" },
                    { line: 3, severity: "CRITICAL", finding_id: "f-b", review_id: "r1" },
                  ],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({
      files: [file],
      findings: [
        makeFinding({ id: "f-a", start_line: 1, end_line: 2 }),
        makeFinding({ id: "f-b", start_line: 3, end_line: 4 }),
      ],
    });

    // Each block's first row carries a top rule and its last row a bottom rule,
    // so the seam between line 2 and line 3 is visible.
    expect(rowFor("src/a.ts", 1).style.boxShadow).toContain("inset 0 1px");
    expect(rowFor("src/a.ts", 2).style.boxShadow).toContain("inset 0 -1px");
    expect(rowFor("src/a.ts", 3).style.boxShadow).toContain("inset 0 1px");
    expect(rowFor("src/a.ts", 4).style.boxShadow).toContain("inset 0 -1px");

    // An interior row of a longer block gets no rule at all — the block reads as
    // one continuous span rather than a stack of bordered rows.
    cleanup();
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1],
                  finding_count: 1,
                  finding_marks: [{ line: 1, severity: "CRITICAL", finding_id: "f-a", review_id: "r1" }],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({ files: [file], findings: [makeFinding({ id: "f-a", start_line: 1, end_line: 4 })] });
    expect(rowFor("src/a.ts", 2).style.boxShadow).toBe("");
    expect(rowFor("src/a.ts", 3).style.boxShadow).toBe("");
  });

  it("the tooltip is fully opaque — no fade animation lets code show through it", async () => {
    const file = makeFile("src/a.ts", "@@ -1,1 +1,1 @@\n+one");
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
                  deletions: 0,
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
    renderSection({
      files: [file],
      onGoToFinding: () => {},
      findings: [makeFinding({ id: "f1", start_line: 1, end_line: 1 })],
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Go to this blocker/ }).parentElement!);
    const tip = await screen.findByRole("tooltip");

    // `ddpop` animates opacity 0 → 1; a tooltip caught mid-fade showed the diff
    // text straight through it, so this panel must not use it.
    expect(tip.style.animation).toBe("");
    expect(tip.style.opacity).toBe("");
    // An opaque token, not a translucent one.
    expect(tip.style.background).toBe("var(--bg-elevated)");
  });

  it("an open tooltip is not painted over by the badge of a row below it", async () => {
    // Two findings on separate rows — the exact shape that regressed: hovering
    // the first one's badge, the SECOND badge drew on top of the tooltip.
    const file = makeFile("src/a.ts", "@@ -1,4 +1,4 @@\n+one\n+two\n+three\n+four");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 4,
                  deletions: 0,
                  finding_lines: [1, 3],
                  finding_count: 2,
                  finding_marks: [
                    { line: 1, severity: "SUGGESTION", finding_id: "f-top", review_id: "r1" },
                    { line: 3, severity: "SUGGESTION", finding_id: "f-below", review_id: "r1" },
                  ],
                },
              ],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
        }),
      }),
    );
    renderSection({
      files: [file],
      onGoToFinding: () => {},
      findings: [
        makeFinding({ id: "f-top", severity: "SUGGESTION", start_line: 1, end_line: 1 }),
        makeFinding({ id: "f-below", severity: "SUGGESTION", start_line: 3, end_line: 3 }),
      ],
    });

    const topRow = rowFor("src/a.ts", 1);
    const rowBelow = rowFor("src/a.ts", 3);

    // Both rows are `position: relative`, so with no z-index they paint in DOM
    // order and the lower row wins. Nothing is lifted before hovering.
    expect(topRow.style.zIndex).toBe("");
    expect(rowBelow.style.zIndex).toBe("");

    const topBadge = screen.getAllByRole("button", { name: /Go to this suggestion/ })[0]!.parentElement!;
    fireEvent.mouseEnter(topBadge);
    await screen.findByRole("tooltip");

    // The row owning the tooltip is lifted above its siblings; the row below is
    // NOT, so it can no longer paint over the tooltip.
    expect(topRow.style.zIndex).toBe("2");
    expect(rowBelow.style.zIndex).toBe("");

    // And the badge slot itself must NOT carry a z-index: that would make each
    // slot its own stacking context and trap the tooltip inside it again.
    const slot = screen.getAllByText("suggestion")[0]!.closest("span[style*='absolute']") as HTMLElement;
    expect(slot.style.zIndex).toBe("");

    // Lifting is temporary — the diff keeps no permanent stacking layers.
    fireEvent.mouseLeave(topBadge);
    expect(topRow.style.zIndex).toBe("");
  });

  it("the mark badge is out of flow, so a finding row cannot be taller than a plain one", () => {
    const file = makeFile("src/a.ts", "@@ -1,2 +1,2 @@\n+marked\n+plain");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [
                {
                  path: "src/a.ts",
                  additions: 2,
                  deletions: 0,
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
    renderSection({ files: [file], findings: [makeFinding({ id: "f1", start_line: 1, end_line: 1 })] });

    // jsdom does no layout, so height itself is unmeasurable here — assert the
    // mechanism that guarantees it: the badge slot is absolutely positioned, so
    // it is outside the row's flex flow and cannot contribute to its height.
    const badgeSlot = screen.getByText("blocker").closest("span[style*='absolute']");
    expect(badgeSlot).not.toBeNull();

    // And the row itself is the positioning context for it.
    const markedRow = rowFor("src/a.ts", 1);
    expect(markedRow.style.position).toBe("relative");
    expect(markedRow).toContainElement(badgeSlot as HTMLElement);

    // The row's line-height is untouched — the same 20px a plain row gets.
    const plainRow = screen.getByText("plain").closest("div") as HTMLElement;
    expect(markedRow.style.lineHeight).toBe(plainRow.style.lineHeight);
  });

  it("hovering a mark badge shows a tooltip with the finding's title and rationale", async () => {
    const file = makeFile("src/a.ts", "@@ -1,1 +1,1 @@\n+one");
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
                  deletions: 0,
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
    renderSection({
      files: [file],
      onGoToFinding: () => {},
      findings: [
        makeFinding({
          id: "f1",
          start_line: 1,
          end_line: 1,
          title: "Hardcoded Stripe secret",
          rationale: "A live key committed in plaintext must be rotated, not just moved.",
        }),
      ],
    });

    // Nothing in the DOM until hovered — the tooltip is a preview, not markup
    // every finding row carries.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Hover the badge's own wrapper (the element that owns the hover handlers),
    // reached from the badge button rather than by walking anonymous spans.
    const badgeWrap = screen.getByRole("button", { name: /Go to this blocker/ }).parentElement!;
    fireEvent.mouseEnter(badgeWrap);

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Hardcoded Stripe secret");
    expect(tip).toHaveTextContent(/must be rotated/);
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

  it("order='original' hides the grouped view but keeps the toggle mounted", () => {
    const file = makeFile("src/core.ts");
    mockedUseSmartDiff.mockReturnValue(
      queryResult({
        data: makeSmartDiff({
          groups: [
            {
              role: "core",
              files: [{ path: "src/core.ts", additions: 1, deletions: 1, finding_lines: [], finding_count: 0 }],
            },
            { role: "wiring", files: [] },
            { role: "boilerplate", files: [] },
          ],
          split_suggestion: {
            too_big: true,
            total_lines: 981,
            proposed_splits: [{ name: "demo", files: ["src/core.ts"] }],
          },
        }),
      }),
    );
    renderSection({ files: [file], order: "original" });

    // The reviewer-ordered body is gone: no group headers, no file cards,
    // no split callout.
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
    expect(screen.queryByText("src/core.ts")).not.toBeInTheDocument();
    expect(screen.queryByText(/This PR is large/i)).not.toBeInTheDocument();

    // The toggle survives — it is the only way back to "smart".
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "false");
  });

  it("order='original' shows neither the loading skeleton nor the error line", () => {
    mockedUseSmartDiff.mockReturnValue(queryResult({ isLoading: true }));
    const { unmount } = renderSection({ order: "original" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();

    mockedUseSmartDiff.mockReturnValue(queryResult({ isError: true }));
    renderSection({ order: "original" });
    expect(screen.queryByText("Couldn't load the reviewer-ordered diff.")).not.toBeInTheDocument();
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
