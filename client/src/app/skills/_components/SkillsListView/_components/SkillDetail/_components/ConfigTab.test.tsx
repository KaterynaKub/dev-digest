import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const updateMutate = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, data: undefined }),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\nEvaluate the pull request.",
  enabled: true,
  version: 5,
  evidence_files: null,
};

function renderTab(skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ConfigTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

describe("ConfigTab", () => {
  it("explains that the description is the skill's interface", () => {
    renderTab();
    expect(screen.getByText(/the agent reads it to decide whether the skill applies/i)).toBeInTheDocument();
  });

  it("labels the body editor with the skill filename and a token estimate", () => {
    renderTab();
    expect(screen.getByText("pr-quality-rubric.md")).toBeInTheDocument();
    expect(screen.getByText(/\d+ tokens/)).toBeInTheDocument();
  });

  it("flags the body as unsaved only after it diverges from the persisted skill", () => {
    renderTab();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();

    // getByDisplayValue collapses whitespace, so a multi-line body never
    // matches as an exact string — match the textarea by its first line.
    fireEvent.change(screen.getByDisplayValue(/^# PR Quality Rubric/), { target: { value: "# Changed" } });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("saves every field in one explicit mutation", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), { target: { value: "renamed-rubric" } });
    fireEvent.click(screen.getByRole("button", { name: /save skill/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sk1",
        patch: expect.objectContaining({
          name: "renamed-rubric",
          type: "rubric",
          body: SKILL.body,
          enabled: true,
        }),
      }),
      expect.anything(),
    );
  });
});
