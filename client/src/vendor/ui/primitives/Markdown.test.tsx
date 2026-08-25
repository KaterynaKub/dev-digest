import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("keeps href for an https: link", () => {
    render(<Markdown>{"[y](https://example.com)"}</Markdown>);
    expect(screen.getByText("y")).toHaveAttribute("href", "https://example.com");
  });

  it("keeps href for an http: link", () => {
    render(<Markdown>{"[y](http://example.com)"}</Markdown>);
    expect(screen.getByText("y")).toHaveAttribute("href", "http://example.com");
  });

  it("keeps href for a mailto: link", () => {
    render(<Markdown>{"[z](mailto:a@example.com)"}</Markdown>);
    expect(screen.getByText("z")).toHaveAttribute("href", "mailto:a@example.com");
  });

  it("keeps href for a same-document relative link", () => {
    render(<Markdown>{"[w](docs/other.md)"}</Markdown>);
    expect(screen.getByText("w")).toHaveAttribute("href", "docs/other.md");
  });

  it("keeps href for a hash-only anchor link", () => {
    render(<Markdown>{"[h](#section)"}</Markdown>);
    expect(screen.getByText("h")).toHaveAttribute("href", "#section");
  });

  // `[x](javascript:alert(1))` — the AC-50 headline case. `react-markdown`'s
  // own default URL transform already blanks this scheme to `""` before our
  // renderer sees it; `isSafeHref` treats an empty href as unsafe too (rather
  // than as a bare same-origin reference), so no clickable link survives
  // either layer.
  it("strips href from a javascript: link but keeps the visible text (AC-50)", () => {
    render(<Markdown>{"[x](javascript:alert(1))"}</Markdown>);
    const link = screen.getByText("x");
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("href");
  });

  it("strips href from a data: link", () => {
    render(<Markdown>{"[x](data:text/html,body)"}</Markdown>);
    expect(screen.getByText("x")).not.toHaveAttribute("href");
  });

  it("strips href from an unrecognised custom scheme", () => {
    render(<Markdown>{"[x](myapp:launch)"}</Markdown>);
    expect(screen.getByText("x")).not.toHaveAttribute("href");
  });

  // `rehype-raw` is deliberately never added, so a literal HTML anchor in the
  // source is escaped text, not a mounted DOM node — this is the OTHER half
  // of AC-50, already true before this change and re-asserted here so a
  // future edit that adds `rehype-raw` back breaks a test, not just a review.
  it("never mounts a raw HTML anchor as a real link", () => {
    render(<Markdown>{'<a href="javascript:alert(1)">raw</a>'}</Markdown>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/raw/)).toBeInTheDocument();
  });

  it("never executes raw HTML embedded in the document", () => {
    render(<Markdown>{'<img src=x onerror="window.__pwned = true">'}</Markdown>);
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("renders plain paragraph text unaffected", () => {
    render(<Markdown>{"Hello **world**"}</Markdown>);
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders nothing for null/empty content", () => {
    const { container } = render(<Markdown>{null}</Markdown>);
    expect(container).toBeEmptyDOMElement();
  });
});
