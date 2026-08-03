/* CreateSkillFromConventionsModal — turn the accepted conventions into a Skill.

   The server builds the merged markdown (GET .../skill-draft); everything here
   is editable before it is saved, and NOTHING is persisted until "Create
   skill" issues a normal POST /skills. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  ErrorState,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { estimateTokens, MODAL_WIDTH, SKILL_TYPES } from "./constants";
import { s } from "./styles";

export interface CreateSkillFromConventionsModalProps {
  draft: ConventionSkillDraft | undefined;
  isLoading: boolean;
  isError: boolean;
  repoLabel: string;
  onClose: () => void;
}

export function CreateSkillFromConventionsModal({
  draft,
  isLoading,
  isError,
  repoLabel,
  onClose,
}: CreateSkillFromConventionsModalProps) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState("");
  const [savedVersion, setSavedVersion] = React.useState<number | null>(null);

  // Seed from the draft exactly once it arrives; later edits are the user's.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!draft || seeded.current) return;
    seeded.current = true;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setBody(draft.body);
  }, [draft]);

  const valid = name.trim().length > 0 && body.trim().length > 0;

  const submit = () => {
    if (!draft || !valid) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || draft.description,
        type,
        source: "extracted",
        body,
        evidence_files: draft.evidence_files,
      },
      {
        onSuccess: (skill) => {
          setSavedVersion(skill.version);
          router.push(`/skills/${skill.id}`);
        },
      },
    );
  };

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: v }));

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={draft?.slug}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {savedVersion !== null && (
            <span style={s.footerNote}>{t("modal.savedAs", { version: savedVersion })}</span>
          )}
          <div style={s.footerActions}>
            <Button kind="ghost" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={!draft || !valid || create.isPending}
              onClick={submit}
            >
              {create.isPending ? t("modal.creating") : t("modal.create")}
            </Button>
          </div>
        </div>
      }
    >
      {isError && <ErrorState body={t("modal.draftError")} />}

      {isLoading && !draft && (
        <div style={s.body}>
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={180} />
        </div>
      )}

      {draft && (
        <div style={s.body}>
          <div style={s.banner}>
            <Icon.Sparkles size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span>{t("modal.info", { count: draft.merged_count, repo: repoLabel })}</span>
          </div>

          <FormField label={t("modal.name")} required>
            <TextInput value={name} onChange={setName} />
          </FormField>

          <FormField label={t("modal.description")}>
            <Textarea value={description} onChange={setDescription} rows={2} />
          </FormField>

          <div style={s.grid}>
            <FormField label={t("modal.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={typeOptions}
              />
            </FormField>

            {/* Read-only on purpose: `POST /skills` forces enabled:false for
                every non-'manual' source. That vetting gate is the one place
                imported content is held back, so the toggle reports the truth
                instead of silently disagreeing with the server. */}
            <div style={s.enabledWrap}>
              <span style={s.enabledLabel}>{t("modal.enabled")}</span>
              <div style={s.enabledRow}>
                <Toggle on={false} onChange={() => {}} size={16} />
              </div>
              <span style={s.hint}>{t("modal.enabledHint")}</span>
            </div>
          </div>

          <FormField label={t("modal.body")} required>
            <div style={s.bodyBox}>
              <div style={s.bodyBar}>
                <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={s.bodyFile}>
                  {t("modal.bodyFile", { slug: draft.slug })}
                </span>
                <Badge color="var(--warn, #b45309)">{t("modal.unsaved")}</Badge>
                <span className="tnum" style={s.tokens}>
                  {t("modal.tokens", { count: estimateTokens(body) })}
                </span>
              </div>
              <Textarea value={body} onChange={setBody} rows={16} mono />
            </div>
          </FormField>
        </div>
      )}
    </Modal>
  );
}
