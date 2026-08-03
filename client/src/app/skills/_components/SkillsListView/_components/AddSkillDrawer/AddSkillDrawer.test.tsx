import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillDraft } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const DRAFT: SkillDraft = {
  name: "Extracted Skill",
  description: "Parsed from the uploaded file",
  type: "custom",
  body: "# Extracted\nBody text.",
  source_entry: "skills/test-quality/SKILL.md",
};

const previewMutate = vi.fn((_file: File, opts?: { onSuccess?: (d: SkillDraft) => void }) => {
  opts?.onSuccess?.(DRAFT);
});
const createMutate = vi.fn();

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useImportSkillPreview: () => ({ mutate: previewMutate, isPending: false }),
  useCreateSkill: () => ({ mutate: createMutate, isPending: false }),
}));

import { AddSkillDrawer } from "./AddSkillDrawer";

afterEach(() => {
  cleanup();
  previewMutate.mockClear();
  createMutate.mockClear();
});

function renderWithIntl(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <AddSkillDrawer onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

function makeFile(name = "skill.md") {
  return new File(["# Extracted\nBody text."], name, { type: "text/markdown" });
}

describe("AddSkillDrawer", () => {
  it("selecting a file calls the preview mutation and renders the draft in editable fields", async () => {
    renderWithIntl();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(previewMutate).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByDisplayValue("Extracted Skill")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Parsed from the uploaded file")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Body text\./)).toBeInTheDocument();
    // create must NOT have been called just from selecting/previewing the file.
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("shows the source_entry and the untrusted notice after preview", async () => {
    renderWithIntl();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(screen.getByText("skills/test-quality/SKILL.md")).toBeInTheDocument());
    expect(screen.getByText(/untrusted source/i)).toBeInTheDocument();
  });

  it("create is called only after the explicit Save/import click, not on file selection", async () => {
    renderWithIntl();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await waitFor(() => screen.getByDisplayValue("Extracted Skill"));

    expect(createMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Import skill"));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "imported_url",
        evidence_files: ["skills/test-quality/SKILL.md"],
      }),
      expect.anything(),
    );
  });
});
