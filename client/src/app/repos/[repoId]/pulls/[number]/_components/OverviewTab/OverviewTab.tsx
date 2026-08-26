"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string | null;
  /** The PR's head sha — forwarded to PrBriefCard only (BlastRadiusCard pins
   *  to the index's own sha instead). Optional, matching every other prop
   *  here, so the tab stays renderable without a host. */
  headSha?: string | null;
  /** Forwarded to BlastRadiusCard and PrBriefCard untouched — opens a
   *  `file`:`line`, pinned per `pin`: `"index"` resolves against the commit
   *  the caller's coordinates were recorded at (blast), `"head"` always
   *  resolves against the PR's head sha (brief, AC-45). The page owns the
   *  destination (Diff tab vs GitHub); this tab only passes it through.
   *  Optional, so the tab stays renderable without a host. */
  onGoToLocation?: (file: string, line: number, sha: string | null, pin: "index" | "head") => void;
}

/**
 * Overview tab: PR description, then PR BRIEF full width (AC-49, design
 * finding D-10 — "read these first" must not sit below the fold), then
 * INTENT + BLAST RADIUS side by side. `IntentCard` moved here from
 * FindingsTab so the two cards can share a two-column grid per the mockup
 * (spec 0007-blast-radius.md §6.1) — it is no longer rendered in FindingsTab.
 */
export function OverviewTab({ prBody, prId, repoId, headSha, onGoToLocation }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}

      <PrBriefCard
        prId={prId}
        repoId={repoId}
        headSha={headSha ?? null}
        onGoToLocation={onGoToLocation}
      />

      <div style={s.grid}>
        <div style={s.gridItem}>
          <IntentCard prId={prId} />
        </div>
        <div style={s.gridItem}>
          <BlastRadiusCard prId={prId} repoId={repoId} onGoToLocation={onGoToLocation} />
        </div>
      </div>
    </>
  );
}
