import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
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
};

function renderCard(candidate: ConventionCandidate, handlers = {}) {
  const props = {
    candidate,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onEdit: vi.fn(),
    onUndo: vi.fn(),
    ...handlers,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ConventionCard", () => {
  it("renders the category, rule, evidence range and confidence", () => {
    renderCard(CANDIDATE);
    expect(screen.getByText("Async")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("fires accept / reject / edit with the right candidate", () => {
    const props = renderCard(CANDIDATE);
    fireEvent.click(screen.getByText("Accept as Skill"));
    expect(props.onAccept).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Reject"));
    expect(props.onReject).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Edit first"));
    expect(props.onEdit).toHaveBeenCalledWith(CANDIDATE);
  });

  it("an accepted card shows the Accepted badge and hides the accept action", () => {
    renderCard({ ...CANDIDATE, status: "accepted" });
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("Accept as Skill")).not.toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
  });

  it("a rejected card stays visible and offers Undo", () => {
    const props = renderCard({ ...CANDIDATE, status: "rejected" });
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    // Still rendered — "Reject all" must read as undoable, not as data loss.
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Undo"));
    expect(props.onUndo).toHaveBeenCalledWith("c1");
  });

  it("marks an edited candidate", () => {
    renderCard({ ...CANDIDATE, edited: true });
    expect(screen.getByText("edited")).toBeInTheDocument();
  });

  it("links the evidence path to the github blob at the cited range", () => {
    renderCard(CANDIDATE, { repoFullName: "acme/api", repoRef: "main" });
    expect(screen.getByText("src/api/users.ts:23-31")).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/api/users.ts#L23-L31",
    );
  });

  it("falls back to plain text when the repo is unknown", () => {
    renderCard(CANDIDATE);
    expect(screen.getByText("src/api/users.ts:23-31")).not.toHaveAttribute("href");
  });

  it("copies the snippet to the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard(CANDIDATE);
    fireEvent.click(screen.getByLabelText("Copy snippet"));
    expect(writeText).toHaveBeenCalledWith(CANDIDATE.evidence_snippet);
  });
});
