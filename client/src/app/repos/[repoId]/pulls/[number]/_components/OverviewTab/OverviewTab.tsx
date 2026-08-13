"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string | null;
}

/**
 * Overview tab: PR description, then INTENT + BLAST RADIUS side by side.
 * `IntentCard` moved here from FindingsTab so the two cards can share a
 * two-column grid per the mockup (spec 0007-blast-radius.md §6.1) — it is
 * no longer rendered in FindingsTab.
 */
export function OverviewTab({ prBody, prId, repoId }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}

      <div style={s.grid}>
        <div style={s.gridItem}>
          <IntentCard prId={prId} />
        </div>
        <div style={s.gridItem}>
          <BlastRadiusCard prId={prId} repoId={repoId} />
        </div>
      </div>
    </>
  );
}
