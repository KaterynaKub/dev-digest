/**
 * PRRow — the row navigates to the PR on click, so the FINDINGS cell must not
 * carry that click through. This is the regression most likely to break
 * silently: the chips keep working, they just also yank the user off the page.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc1234",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T18:00:00.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 61,
    findings: {
      counts: { CRITICAL: 2, WARNING: 2, SUGGESTION: 2 },
      items: [
        {
          id: "f1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded Stripe secret key in commit",
          file: "src/config.ts",
          start_line: 12,
          end_line: 12,
          rationale: "Line 12 contains a literal string starting with sk_live_.",
          confidence: 0.98,
        },
      ],
      truncated: 5,
    },
    ...o,
  } as PrMeta;
}

function renderRow(meta: PrMeta = pr()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={meta} repoId="repo-1" repoFullName="acme/payments-api" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings cell", () => {
  it("does NOT navigate when a severity chip is clicked", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("2 critical findings"));
    expect(push).not.toHaveBeenCalled();
  });

  it("still navigates when the rest of the row is clicked", () => {
    renderRow();
    fireEvent.click(screen.getByText("Add rate limiting to public API endpoints"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });

  it("shows the authoritative counts, not the capped preview length", () => {
    renderRow();
    expect(screen.getByLabelText("2 critical findings")).toBeInTheDocument();
    expect(screen.getByLabelText("2 warning findings")).toBeInTheDocument();
  });

  it("renders a placeholder for a PR that has never been reviewed", () => {
    renderRow(pr({ score: null, findings: null }));
    expect(screen.queryByLabelText(/findings/)).not.toBeInTheDocument();
  });
});
