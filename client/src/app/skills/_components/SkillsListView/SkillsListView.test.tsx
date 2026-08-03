import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

// AppShell pulls in next/navigation router hooks + command palette wiring —
// irrelevant to this view's own loading/error/empty/populated + preview
// behaviour, so it's stubbed to a transparent wrapper (same call as every
// other *ListView test in this repo, none of which render the real shell).
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const skillsState: { data: Skill[] | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const updateMutate = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ ...skillsState, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useCreateSkill: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useImportSkillPreview: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { ToastProvider } from "@/lib/toast";
import { SkillsListView } from "./SkillsListView";

afterEach(() => {
  cleanup();
  skillsState.data = undefined;
  skillsState.isLoading = false;
  skillsState.isError = false;
  updateMutate.mockClear();
});

function SKILL(o: Partial<Skill> & { id: string; name: string }): Skill {
  return {
    description: "A test skill",
    type: "rubric",
    source: "manual",
    body: "# Body\nSome rule text.",
    enabled: true,
    version: 1,
    evidence_files: null,
    ...o,
  };
}

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {/* Real ToastProvider, not a stub: SkillDetail's tabs call useToast for
          the not-yet-built actions (Run on evals, version Diff), so the view
          cannot render at all without a provider above it. */}
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/* The card's onClick sits on the outer card div, not on the name span, and
   the name also appears in the detail header once a skill is selected — so
   pick the FIRST match (list order puts the card ahead of the pane) and click
   the card element itself. */
function selectCard(name: string) {
  const [label] = screen.getAllByText(name);
  if (!label) throw new Error(`No skill card labelled "${name}"`);
  fireEvent.click(label.closest("div[style*='cursor: pointer']") ?? label);
}

describe("SkillsListView", () => {
  it("shows loading skeletons", () => {
    skillsState.isLoading = true;
    renderWithIntl();
    expect(screen.getByText("Skills")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    skillsState.isError = true;
    renderWithIntl();
    expect(screen.getByText("Could not load skills.")).toBeInTheDocument();
  });

  it("shows the empty state when there are no skills", () => {
    skillsState.data = [];
    renderWithIntl();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });

  it("renders skill cards and opens the detail pane on click", () => {
    skillsState.data = [SKILL({ id: "sk1", name: "Test Coverage Rubric" })];
    renderWithIntl();
    expect(screen.getByText("Test Coverage Rubric")).toBeInTheDocument();
    // Nothing selected yet → empty-detail prompt.
    expect(screen.getByText("Select a skill")).toBeInTheDocument();

    selectCard("Test Coverage Rubric");
    // Selecting lands on Config, so the editable body — not the rendered
    // Markdown — is what shows first.
    // getByDisplayValue collapses whitespace — match the multi-line body by
    // its first line rather than as an exact string.
    expect(screen.getByDisplayValue(/^# Body/)).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders the skill body as Markdown on the Preview tab", () => {
    skillsState.data = [SKILL({ id: "sk1", name: "Test Coverage Rubric" })];
    renderWithIntl();
    selectCard("Test Coverage Rubric");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Some rule text.")).toBeInTheDocument();
  });

  it("shows a Coming soon state for the unimplemented Evals and Stats tabs", () => {
    skillsState.data = [SKILL({ id: "sk1", name: "Test Coverage Rubric" })];
    renderWithIntl();
    selectCard("Test Coverage Rubric");

    fireEvent.click(screen.getByRole("button", { name: "Evals" }));
    expect(screen.getByText("Evals are coming soon")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getByText("Stats are coming soon")).toBeInTheDocument();
  });

  it("keeps the selected skill in the detail pane when the search filters it out", () => {
    skillsState.data = [
      SKILL({ id: "sk1", name: "Test Coverage Rubric" }),
      SKILL({ id: "sk2", name: "Secret Leakage Gate" }),
    ];
    renderWithIntl();
    selectCard("Test Coverage Rubric");

    fireEvent.change(screen.getByPlaceholderText("Search skills…"), { target: { value: "secret" } });

    // Filtered out of the list, but still the skill being edited: the name
    // survives in the detail header and in the (editable) name field.
    expect(screen.getByDisplayValue("Test Coverage Rubric")).toBeInTheDocument();
    expect(screen.getByText("Secret Leakage Gate")).toBeInTheDocument();
  });
});
