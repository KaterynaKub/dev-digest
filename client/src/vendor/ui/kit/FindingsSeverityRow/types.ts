import React from "react";

/** The three severities an agent can report (the UI-only INFO tier is excluded). */
export type SeverityKey = "CRITICAL" | "WARNING" | "SUGGESTION";

export const SEVERITY_KEYS: readonly SeverityKey[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/**
 * View model for one finding in the hover panel. Callers adapt their own wire
 * shape (`FindingSummary` from the PR list, `FindingRecord` from a review) into
 * this, which is what lets one component serve both surfaces.
 */
export interface SeverityFinding {
  id: string;
  severity: SeverityKey;
  /** Rendered via CategoryTag, which returns null for unknown values. */
  category: string;
  title: string;
  file: string;
  /** Pre-formatted "12" or "12-18" — the caller owns the format. */
  lineLabel: string;
  /** Deep link for the file:line link; omit to render non-navigating mono text. */
  href?: string;
  /** 0..1 */
  confidence: number;
  /** Already truncated by the producer; clamped to 3 lines here. */
  rationale: string;
}

/**
 * Localized strings. `vendor/ui` must not import next-intl, so every visible
 * string is injected by the call site (which already has `useTranslations`).
 */
export interface FindingsSeverityLabels {
  /** aria-label for a chip, e.g. (CRITICAL, 3) => "3 critical findings". */
  chip: (severity: SeverityKey, count: number) => string;
  /** Panel heading / aria-label. */
  panelTitle: string;
  /** Shown while a severity filter is active. */
  filterHint?: (severity: SeverityKey) => string;
  /** Footer when the preview is capped, e.g. (8) => "+8 more findings". */
  more: (count: number) => string;
  /** Body when the active filter matches nothing. */
  noneForSeverity: string;
}

export interface FindingsSeverityRowProps {
  findings: SeverityFinding[];
  /**
   * Authoritative counts. Omit to derive them from `findings`. The PR list
   * passes the full (un-capped) counts alongside a capped `findings` preview,
   * so the chips stay truthful; the timeline has every finding client-side and
   * lets them be derived.
   */
  counts?: Record<SeverityKey, number>;
  /** Drives the "+N more" footer. 0 / undefined hides it. */
  truncated?: number;
  /** Horizontal anchor of the panel relative to the trigger. */
  align?: "left" | "right";
  /** Hide chips whose count is 0. Default true. */
  hideEmpty?: boolean;
  /** Rendered instead of the chips when every count is 0. */
  emptyPlaceholder?: React.ReactNode;
  labels: FindingsSeverityLabels;
}
