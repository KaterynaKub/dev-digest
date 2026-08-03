/* AddSkillDrawer — one panel, no Tabs (scope is file/archive import only; the
   "fromUrl"/"community" i18n keys stay unused rather than link to a 404).
   Flow: pick a file → useImportSkillPreview parses it server-side into an
   editable SkillDraft (nothing persisted yet) → user edits the same fields
   the skill editor has → explicit Save calls useCreateSkill with
   source: 'imported_url'. The server forces enabled:false for that source. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Button, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillDraft, SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportSkillPreview } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { ACCEPTED_EXTENSIONS, SKILL_TYPES } from "./constants";
import { s } from "./styles";

export function AddSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = useImportSkillPreview();
  const create = useCreateSkill();

  const [draft, setDraft] = React.useState<SkillDraft | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    preview.mutate(file, {
      onSuccess: (d) => {
        setDraft(d);
        setName(d.name);
        setDescription(d.description);
        setType(d.type);
        setBody(d.body);
      },
      onError: (err) => {
        setError(err instanceof ApiError ? err.message : t("drawer.importFailed"));
      },
    });
  };

  const handleCreate = () => {
    setError(null);
    create.mutate(
      {
        name,
        description,
        type,
        source: "imported_url",
        body,
        evidence_files: draft?.source_entry ? [draft.source_entry] : undefined,
      },
      {
        onSuccess: (skill) => {
          toast.success(t("file.success", { name: skill.name }));
          onClose();
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : t("drawer.importFailed"));
        },
      },
    );
  };

  return (
    <Drawer
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        draft && (
          <div style={s.actions}>
            <Button kind="primary" icon="Check" onClick={handleCreate} disabled={create.isPending}>
              {create.isPending ? t("file.importing") : t("file.import")}
            </Button>
          </div>
        )
      }
    >
      {error && <div style={s.error}>{error}</div>}

      {!draft && (
        <div style={s.pickWrap}>
          <label style={s.pickLabel}>
            {preview.isPending ? t("file.importing") : t("file.import")}
            <input
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              style={s.hiddenInput}
              disabled={preview.isPending}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <span style={s.pickHint}>{t("file.bodyHint")}</span>
        </div>
      )}

      {draft && (
        <>
          {draft.source_entry && (
            <div style={s.sourceEntry}>
              Extracted from <code className="mono">{draft.source_entry}</code>
            </div>
          )}
          <div style={s.notice}>{t("preview.untrustedNotice")}</div>

          <FormField label={t("editor.name")} required>
            <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
          </FormField>
          <FormField label={t("editor.description")} hint={t("editor.descriptionHint")} required>
            <Textarea value={description} onChange={setDescription} rows={2} />
          </FormField>
          <FormField label={t("editor.type")}>
            <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
          </FormField>
          <FormField label={t("editor.body")} hint={t("preview.bodyHint")}>
            <Textarea value={body} onChange={setBody} rows={16} mono />
          </FormField>
        </>
      )}
    </Drawer>
  );
}
