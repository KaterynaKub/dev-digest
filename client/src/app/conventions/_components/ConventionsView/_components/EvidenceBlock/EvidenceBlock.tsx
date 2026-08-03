/* EvidenceBlock — the `path:start-end` strip + copy button over the snippet
   that was sliced off disk by the server's verification gate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export interface EvidenceBlockProps {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export function EvidenceBlock({ path, startLine, endLine, snippet }: EvidenceBlockProps) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(snippet || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const label = copied ? t("evidence.copied") : t("evidence.copy");

  return (
    <div style={s.box}>
      <div style={s.bar}>
        <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.path}>
          {`${path}:${startLine}-${endLine}`}
        </span>
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
