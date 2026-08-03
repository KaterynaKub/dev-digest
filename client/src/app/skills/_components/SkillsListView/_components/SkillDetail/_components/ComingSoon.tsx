/* ComingSoon — shared placeholder for tabs whose backing feature is not built
   (Evals, Stats) and for the community catalog. Deliberately renders no
   sample numbers: a fabricated "71% pull" reads as measured data and would
   misrepresent what the product actually knows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, type IconName } from "@devdigest/ui";
import { s } from "../styles";

export function ComingSoon({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const t = useTranslations("skills");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Badge color="var(--text-muted)">{t("comingSoon")}</Badge>
      </div>
      <EmptyState icon={icon} title={title} body={<span style={s.emptyBody}>{body}</span>} />
    </div>
  );
}
