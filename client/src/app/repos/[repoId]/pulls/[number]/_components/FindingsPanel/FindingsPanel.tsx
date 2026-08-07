/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
  targetNonce = 0,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** A finding to focus/scroll to (e.g. from a Smart Diff badge click). */
  targetFindingId?: string | null;
  /** Bumped by the caller to re-trigger the scroll on a repeat click. */
  targetNonce?: number;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  // Focus a finding requested from outside (e.g. a Smart Diff mark click).
  // Scoped to `containerRef` — several accordions/panels can be open at once,
  // so an unscoped querySelector could grab a sibling panel's card.
  React.useEffect(() => {
    if (!targetFindingId) return;
    if (!findings.some((f) => f.id === targetFindingId)) return; // not owned by this panel
    if (!shown.some((f) => f.id === targetFindingId)) {
      // A reviewer who clicked this finding in the Smart Diff asked for it
      // explicitly — a display filter must not silently swallow the target.
      // This effect re-runs when `shown` changes (hideLow flips) and
      // completes on the second pass.
      setHideLow(false);
      return;
    }
    // Recompute from the id whenever `shown` changes rather than storing a
    // bare index, bo a refetch would otherwise leave the index pointing at
    // the wrong card.
    setFocusIdx(shown.findIndex((f) => f.id === targetFindingId));
    const node = containerRef.current?.querySelector(`[data-finding-id="${targetFindingId}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [targetFindingId, targetNonce, findings, shown]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list} ref={containerRef}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            // scrollMarginTop lives here rather than on FindingCard itself
            // (which stays unmodified) — same reasoning as
            // ReviewRunAccordion's own scrollMarginTop: the smooth scroll
            // must not tuck the card under the sticky header.
            <div key={f.id} style={s.listItem}>
              <FindingCard
                f={f}
                focused={i === focusIdx}
                defaultExpanded={i === 0 || f.id === targetFindingId}
                pending={action.isPending}
                repoFullName={repoFullName}
                headSha={headSha}
                onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
