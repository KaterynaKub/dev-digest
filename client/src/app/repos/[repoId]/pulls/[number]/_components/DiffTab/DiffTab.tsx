"use client";

import React from "react";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffSection } from "../SmartDiffSection";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Forwarded to SmartDiffSection untouched — widens its per-line finding marks
   *  into whole-block highlights and fills the mark tooltips. */
  findings?: FindingRecord[];
  /** Forwarded to SmartDiffSection untouched — navigates a mark badge click to
   *  that finding's card in the Findings tab. */
  onGoToFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, findings, onGoToFinding }: DiffTabProps) {
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // DiffTab owns which ordering is shown: SmartDiffSection renders the
  // reviewer-ordered groups; "original" falls back to today's plain DiffViewer
  // (which alone carries inline commenting — SmartDiffSection deliberately
  // does not reimplement it).
  const [order, setOrder] = React.useState<"smart" | "original">("smart");

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SmartDiffSection
        prId={prId}
        files={files}
        order={order}
        onOrderChange={setOrder}
        findings={findings}
        onGoToFinding={onGoToFinding}
      />

      {order === "original" && (
        <>
          <SectionLabel
            icon="Code"
            right={
              commentCount > 0 ? (
                <Button
                  kind="ghost"
                  size="sm"
                  icon={showComments ? "EyeOff" : "Eye"}
                  onClick={() => setShowComments((v) => !v)}
                >
                  {showComments ? "Hide comments" : "Show comments"} ({commentCount})
                </Button>
              ) : undefined
            }
          >
            Files changed · {filesCount} files
          </SectionLabel>
          <DiffViewer files={files} commenting={commenting} />
        </>
      )}
    </section>
  );
}
