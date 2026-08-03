import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "Reviews test quality",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review tests.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function skill(o: Partial<Skill> & { id: string; name: string }): Skill {
  return {
    description: "desc",
    type: "rubric",
    source: "manual",
    body: "# body",
    enabled: true,
    version: 1,
    evidence_files: null,
    ...o,
  };
}

const ALL_SKILLS: Skill[] = [
  skill({ id: "s1", name: "Coverage Rubric" }),
  skill({ id: "s2", name: "Edge Case Checklist" }),
  skill({ id: "s3", name: "Mocking Discipline", enabled: false }),
  skill({ id: "s4", name: "Unlinked Skill" }),
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "s1", order: 0 },
  { agent_id: "ag1", skill_id: "s2", order: 1 },
  { agent_id: "ag1", skill_id: "s3", order: 2 },
];

const setAgentSkillsMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useAgentSkills: () => ({ data: LINKS }),
  useSkills: () => ({ data: ALL_SKILLS }),
  useSetAgentSkills: () => ({ mutate: setAgentSkillsMutate, isPending: false, isSuccess: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setAgentSkillsMutate.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <SkillsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("lists every skill in one list, linked ones first and checked", () => {
    renderWithIntl();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Coverage Rubric",
      "Edge Case Checklist",
      "Mocking Discipline",
      "Unlinked Skill",
    ]);
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "false"]);
  });

  it("counts linked skills against the whole library", () => {
    renderWithIntl();
    expect(screen.getByText("3 of 4 enabled")).toBeInTheDocument();
  });

  it("shows a disabled warning for a linked-but-disabled skill", () => {
    renderWithIntl();
    expect(screen.getByText(/skipped when the prompt is assembled/i)).toBeInTheDocument();
  });

  it("checking an unlinked skill saves the full set immediately", () => {
    renderWithIntl();
    fireEvent.click(screen.getByRole("checkbox", { name: "Unlinked Skill" }));
    expect(setAgentSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skillIds: ["s1", "s2", "s3", "s4"] },
      expect.anything(),
    );
  });

  it("unchecking a linked skill detaches it and saves", () => {
    renderWithIntl();
    fireEvent.click(screen.getByRole("checkbox", { name: "Edge Case Checklist" }));
    expect(setAgentSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skillIds: ["s1", "s3"] },
      expect.anything(),
    );
  });

  it("moving a linked skill up saves skill_ids in the new order", () => {
    renderWithIntl();
    fireEvent.click(screen.getByLabelText("Move Edge Case Checklist up"));
    expect(setAgentSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skillIds: ["s2", "s1", "s3"] },
      expect.anything(),
    );
  });

  it("the up arrow is disabled on the first linked row and the down arrow on the last", () => {
    renderWithIntl();
    expect(screen.getByLabelText("Move Coverage Rubric up")).toBeDisabled();
    expect(screen.getByLabelText("Move Mocking Discipline down")).toBeDisabled();
  });

  it("an unlinked skill has no reorder controls", () => {
    renderWithIntl();
    expect(screen.queryByLabelText("Move Unlinked Skill up")).not.toBeInTheDocument();
  });

  it("dragging a row onto an earlier one reorders and saves", () => {
    renderWithIntl();
    const rows = screen.getAllByRole("checkbox").map((b) => b.parentElement as HTMLElement);
    const [first, , third] = rows;
    fireEvent.dragStart(third!);
    fireEvent.dragOver(first!);
    fireEvent.drop(first!);
    expect(setAgentSkillsMutate).toHaveBeenCalledWith(
      { agentId: "ag1", skillIds: ["s3", "s1", "s2"] },
      expect.anything(),
    );
  });

  it("filtering narrows the list without touching the linked set", () => {
    renderWithIntl();
    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), { target: { value: "mocking" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(setAgentSkillsMutate).not.toHaveBeenCalled();
  });
});
