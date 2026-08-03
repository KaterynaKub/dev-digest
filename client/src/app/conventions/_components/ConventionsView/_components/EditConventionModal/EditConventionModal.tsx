/* EditConventionModal — the "Edit first" step.

   A modal rather than an inline textarea: the card already carries rule +
   evidence + confidence + three buttons, so editing in place would reflow the
   whole list and fight the code block for width. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, Textarea, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { MODAL_WIDTH, s } from "./styles";

export interface EditConventionModalProps {
  candidate: ConventionCandidate;
  saving?: boolean;
  onSave: (patch: { category: string; rule: string }) => void;
  onClose: () => void;
}

export function EditConventionModal({
  candidate,
  saving,
  onSave,
  onClose,
}: EditConventionModalProps) {
  const t = useTranslations("conventions");
  const [category, setCategory] = React.useState(candidate.category);
  const [rule, setRule] = React.useState(candidate.rule);

  const dirty = category !== candidate.category || rule !== candidate.rule;
  const valid = category.trim().length > 0 && rule.trim().length > 0;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("edit.title")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("edit.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            disabled={saving || !dirty || !valid}
            onClick={() => onSave({ category: category.trim(), rule: rule.trim() })}
          >
            {saving ? t("edit.saving") : t("edit.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("edit.category")} required>
          <TextInput value={category} onChange={setCategory} />
        </FormField>
        <FormField label={t("edit.rule")} hint={t("edit.ruleHint")} required>
          <Textarea value={rule} onChange={setRule} rows={3} />
        </FormField>
      </div>
    </Modal>
  );
}
