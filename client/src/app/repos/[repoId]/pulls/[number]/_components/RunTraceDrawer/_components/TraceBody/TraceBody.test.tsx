import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

/** A trace with everything but `specs_read` held constant across both shapes. */
function traceWith(overrides: Partial<RunTrace>): RunTrace {
  return {
    config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
    stats: {
      duration_ms: 8200,
      tokens_in: 12000,
      tokens_out: 1500,
      cost_usd: 0.06,
      cost_source: "exact",
      findings: 0,
      grounding: "0/0 passed",
    },
    prompt_assembly: { system: "You are a reviewer.", skills: null, memory: null, specs: null, user: "Review PR #482" },
    tool_calls: [],
    raw_output: "{}",
    memory_pulled: [],
    specs_read: [],
    log: [],
    ...overrides,
  } as RunTrace;
}

function renderBody(trace: RunTrace, findings: FindingRecord[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages } as never}>
      <TraceBody trace={trace} findings={findings} />
    </NextIntlClientProvider>,
  );
}

describe("TraceBody — specs_read renders BOTH persisted shapes", () => {
  it("a legacy trace of bare string paths renders the path with no badges and no 'unknown' placeholders", () => {
    // Traces written before the project-context feature hold plain strings.
    // Nothing on the server parses a trace, so this shape still reaches the
    // renderer today — it must not throw and must not invent missing facts.
    renderBody(traceWith({ specs_read: ["docs/a.md"] }));

    expect(screen.getByText("docs/a.md")).toBeInTheDocument();
    // No per-run badges exist for a legacy entry.
    expect(screen.queryByText("injected")).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });

  it("an enriched trace renders status, token estimate and origin per document", () => {
    renderBody(
      traceWith({
        specs_read: [
          { path: "specs/api.md", tokens: 317, status: "injected", origin: "agent", skill_name: null },
          {
            path: "docs/arch.md",
            tokens: 0,
            status: "missing",
            origin: "skill",
            skill_name: "pr-quality-rubric",
          },
        ],
      }),
    );

    expect(screen.getByText("specs/api.md")).toBeInTheDocument();
    expect(screen.getByText("injected")).toBeInTheDocument();
    // AC-16 — the estimate always carries its approximation marker.
    expect(screen.getByText(/≈\s*317\s*tokens/)).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();

    // AC-56/AC-40 — a degraded document is visibly distinct, and an inherited
    // one names the skill it came from.
    expect(screen.getByText("docs/arch.md")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByText("via pr-quality-rubric")).toBeInTheDocument();
  });

  it("mixed shapes in one trace both render (a trace persisted across the upgrade)", () => {
    renderBody(
      traceWith({
        specs_read: [
          "docs/legacy.md",
          { path: "specs/new.md", tokens: 42, status: "truncated", origin: "agent", skill_name: null },
        ],
      }),
    );

    expect(screen.getByText("docs/legacy.md")).toBeInTheDocument();
    expect(screen.getByText("specs/new.md")).toBeInTheDocument();
    expect(screen.getByText("truncated")).toBeInTheDocument();
  });

  it("an empty specs_read shows the 'none' placeholder, not an empty row", () => {
    renderBody(traceWith({ specs_read: [] }));
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("NFR-6 — a wholly failed reader is surfaced with its cause", () => {
    renderBody(
      traceWith({ specs_read: [], specs_reader_error: "connection to the clone was lost" }),
    );
    expect(screen.getByText(/connection to the clone was lost/)).toBeInTheDocument();
  });
});
