import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Schemes allowed to become a real, clickable `href` (AC-50). Everything else
 * — `javascript:`, `data:`, `vbscript:`, any custom/unknown scheme, and any
 * URL that fails to parse at all — renders as plain text instead of a
 * dead-looking (but still styled) link. `react-markdown`'s own default
 * sanitizer already blanks the well-known-dangerous schemes to `""` before
 * this component ever sees them; this whitelist is the explicit,
 * independently-verified policy on top of that (an implicit dependency on an
 * upstream default is exactly what silently regresses on a library bump), and
 * it is what actually decides custom/unrecognised schemes, which the upstream
 * transform also blanks but for reasons this file does not control. This is
 * the ONLY half of AC-50 this file is missing: `rehype-raw` is deliberately
 * never added, so raw HTML in a document renders as escaped text, never as a
 * mounted DOM node, before either sanitizer runs.
 */
const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * True for a safe absolute URL (`http(s):`/`mailto:`) or a same-document
 * relative reference (`./docs/x.md`, `#section`, `docs/x.md`). Parsed via the
 * URL constructor against a fixed dummy base, NEVER a regex — a regex on the
 * scheme prefix is exactly what a URL-encoded or whitespace-obfuscated scheme
 * is built to slip past, and the WHATWG URL parser normalises those forms the
 * same way a browser's own address bar would before we ever compare.
 */
function isSafeHref(href: string): boolean {
  // remark/rehype already reduce a handful of dangerous schemes (`data:`
  // among them) to `""` before this component ever sees them — an empty
  // string parses as a same-origin "relative" reference against ANY base and
  // would otherwise slip through the branch below as safe.
  if (!href) return false;
  try {
    const url = new URL(href, "https://x.invalid");
    if (url.origin === "https://x.invalid") {
      // No scheme of its own — resolved against the dummy base, i.e. a
      // relative reference (path and/or hash). Always safe: it can only ever
      // point back into this same origin's routing, never execute script.
      return true;
    }
    return ALLOWED_LINK_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => {
            // An unsafe/unparsable href renders as plain text with NO `href`
            // attribute — not a link stripped down to `<a>` with no target,
            // which would still look and behave like a dead but clickable
            // link. Styling stays identical either way (AC-50 is about the
            // attribute, not the appearance).
            const safe = typeof href === "string" && isSafeHref(href);
            return (
              <a
                href={safe ? href : undefined}
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
