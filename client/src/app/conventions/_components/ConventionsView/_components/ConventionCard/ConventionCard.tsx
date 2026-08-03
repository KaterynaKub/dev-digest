/* ConventionCard — one extracted candidate: category, rule, the evidence it
   was grounded against, its confidence, and the accept/edit/reject actions. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { EvidenceBlock } from "../EvidenceBlock";
import { confidenceColor } from "./constants";
import { s } from "./styles";

export interface ConventionCardProps {
  candidate: ConventionCandidate;
  pending?: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (candidate: ConventionCandidate) => void;
  onUndo: (id: string) => void;
}

export function ConventionCard({
  candidate,
  pending,
  onAccept,
  onReject,
  onEdit,
  onUndo,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const decided = accepted || rejected;
  const percent = Math.round(candidate.confidence * 100);

  return (
    <Card style={s.card(rejected)}>
      <div style={s.row}>
        <div style={s.main}>
          <div style={s.head}>
            <Badge>{candidate.category}</Badge>
            {candidate.edited && <Badge color="var(--warn, #b45309)">{t("card.edited")}</Badge>}
          </div>
          <p style={s.rule}>{candidate.rule}</p>

          <div style={{ marginTop: 12 }}>
            <EvidenceBlock
              path={candidate.evidence_path}
              startLine={candidate.evidence_start_line}
              endLine={candidate.evidence_end_line}
              snippet={candidate.evidence_snippet}
            />
          </div>

          <div style={s.confidenceRow}>
            <span style={s.confidenceLabel}>{t("card.confidence")}</span>
            <div style={s.bar}>
              <ProgressBar value={percent} color={confidenceColor(candidate.confidence)} />
            </div>
            <span className="tnum" style={s.percent}>{`${percent}%`}</span>
          </div>
        </div>

        <div style={s.actions}>
          {accepted && (
            <Button kind="secondary" size="sm" icon="Check" active full disabled>
              {t("card.accepted")}
            </Button>
          )}
          {rejected && (
            <Button kind="ghost" size="sm" icon="X" full disabled>
              {t("card.rejected")}
            </Button>
          )}
          {!decided && (
            <>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                full
                disabled={pending}
                onClick={() => onAccept(candidate.id)}
              >
                {pending ? t("card.accepting") : t("card.acceptAsSkill")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="Edit"
                full
                disabled={pending}
                onClick={() => onEdit(candidate)}
              >
                {t("card.editFirst")}
              </Button>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                full
                disabled={pending}
                onClick={() => onReject(candidate.id)}
              >
                {t("card.reject")}
              </Button>
            </>
          )}
          {decided && (
            <Button
              kind="ghost"
              size="sm"
              icon="History"
              full
              disabled={pending}
              onClick={() => onUndo(candidate.id)}
            >
              {t("card.undo")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
