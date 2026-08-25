import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { buildBlastGraphLayout } from "./helpers";

afterEach(cleanup);

function renderGraph(downstream: DownstreamImpact[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGraph downstream={downstream} />
    </NextIntlClientProvider>,
  );
}

function makeDownstream(overrides: Partial<DownstreamImpact> = {}): DownstreamImpact {
  return {
    symbol: "foo",
    callers: [
      { name: "callerA", file: "a.ts", line: 1 },
      { name: "callerB", file: "b.ts", line: 2 },
    ],
    endpoints_affected: [],
    crons_affected: [],
    ...overrides,
  };
}

describe("BlastGraph", () => {
  it("empty downstream renders blast.graph.empty, not an svg", () => {
    renderGraph([]);
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders an accessible svg with role=img and the graph aria-label", () => {
    renderGraph([makeDownstream()]);
    const svg = screen.getByRole("img", { name: "Blast radius graph" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });

  it("renders a node per symbol and per caller, with an edge per caller", () => {
    renderGraph([makeDownstream()]);
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("callerA")).toBeInTheDocument();
    expect(screen.getByText("callerB")).toBeInTheDocument();
  });

  it("shows a '+N more' line when callers exceed the per-symbol node limit", () => {
    const manyCallers = Array.from({ length: 10 }, (_, i) => ({
      name: `caller${i}`,
      file: `f${i}.ts`,
      line: i,
    }));
    renderGraph([makeDownstream({ callers: manyCallers })]);
    expect(screen.getByText(/more/i)).toBeInTheDocument();
  });
});

describe("buildBlastGraphLayout determinism", () => {
  it("produces byte-identical geometry across two calls with the same input", () => {
    const input = [
      makeDownstream({ symbol: "foo" }),
      makeDownstream({ symbol: "bar", callers: [{ name: "x", file: "x.ts", line: 5 }] }),
    ];

    const first = buildBlastGraphLayout(input);
    const second = buildBlastGraphLayout(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("caps symbol nodes and reports the hidden count", () => {
    const many = Array.from({ length: 12 }, (_, i) => makeDownstream({ symbol: `s${i}` }));
    const layout = buildBlastGraphLayout(many);
    expect(layout.symbolNodes.length).toBeLessThan(many.length);
    expect(layout.hiddenSymbolCount).toBe(many.length - layout.symbolNodes.length);
  });
});
