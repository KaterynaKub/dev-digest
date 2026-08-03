"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingsSeverityLabels } from "@devdigest/ui";

/**
 * Localized strings for FindingsSeverityRow. The component lives in vendor/ui,
 * which must not import next-intl, so the strings are injected by callers —
 * both of which want the identical set, hence this shared hook.
 */
export function useFindingsLabels(): FindingsSeverityLabels {
  const t = useTranslations("prReview");
  return React.useMemo(
    () => ({
      chip: (severity, count) =>
        t("findingsHover.chip", { count, severity: t(`severity.${severity}`) }),
      panelTitle: t("findingsHover.panelTitle"),
      filterHint: (severity) =>
        t("findingsHover.filterHint", { severity: t(`severity.${severity}`) }),
      more: (count) => t("findingsHover.more", { count }),
      noneForSeverity: t("findingsHover.noneForSeverity"),
    }),
    [t],
  );
}
