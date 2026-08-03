import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "Test Coverage Rubric",
  description: "Flag untested branches",
  type: "rubric",
  source: "manual",
  body: "# Rule\nEvery branch needs a test.",
  enabled: true,
  version: 1,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("SkillCard (smoke)", () => {
  it("renders name, type badge, description and source badge", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("Test Coverage Rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Flag untested branches")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("toggle calls onToggle without triggering onClick (stopPropagation)", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows "needs vetting" for a non-manual source', () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it('does NOT show "needs vetting" for a manual source', () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });
});
