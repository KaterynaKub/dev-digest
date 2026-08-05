/* EvidenceBlock — the `path:start-end` strip + copy button over the snippet
   that was sliced off disk by the server's verification gate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink } from "@devdigest/ui";
import { s } from "./styles";

export interface EvidenceBlockProps {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  /** github.com blob deep-link for the cited range; absent when unknown. */
  href?: string;
}

export function EvidenceBlock({ path, startLine, endLine, snippet, href }: EvidenceBlockProps) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(snippet || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const label = copied ? t("evidence.copied") : t("evidence.copy");
  const location = `${path}:${startLine}-${endLine}`;

  return (
    <div style={s.box}>
      <div style={s.bar}>
        <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
        {href ? (
          <span style={s.pathLink} title={t("evidence.openOnGithub")}>
            <MonoLink href={href}>{location}</MonoLink>
          </span>
        ) : (
          <span className="mono" style={s.path}>
            {location}
          </span>
        )}
        <button type="button" title={label} aria-label={label} onClick={copy} style={s.copyBtn}>
          {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
        </button>
      </div>
      <pre className="mono" style={s.pre}>
        {snippet}
      </pre>
    </div>
  );
}
