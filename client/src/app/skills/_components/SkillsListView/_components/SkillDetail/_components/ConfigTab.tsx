/* ConfigTab — the skill's editable configuration. Plain useState-per-field +
   explicit Save (no react-hook-form in this project). Callers must pass
   `key={skill.id}` so switching skills remounts the form and the useState
   initialisers re-seed from the new skill — the same idiom ConfigTab documents
   for agents. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, SelectInput, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { estimateTokens, SKILL_TYPES } from "../constants";
import { s } from "../styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  // Compared against the persisted skill, not a submit count — after a save
  // the server's skill is the new baseline and the chip clears on its own.
  const dirty = body !== skill.body;

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      { onSuccess: (data) => toast.success(t("editor.savedToast", { version: data.version })) },
    );

  return (
    <div>
      <div style={s.sectionHead}>
        <h2 style={s.h2}>{t("editor.title")}</h2>
        <Badge mono icon="History">
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {t("editor.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("editor.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("editor.description")} hint={t("editor.descriptionHint")} required>
        <Textarea value={description} onChange={setDescription} rows={2} />
      </FormField>
      <FormField label={t("editor.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>

      <FormField label={t("editor.body")} required>
        <div style={s.bodyBox}>
          <div style={s.bodyBar}>
            <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
            <span className="mono" style={s.bodyFile}>
              {t("editor.bodyFile", { name: skill.name })}
            </span>
            {dirty && <Badge color="var(--warn, #b45309)">{t("editor.unsaved")}</Badge>}
            <span className="tnum" style={s.tokens}>
              {t("editor.tokens", { count: estimateTokens(body) })}
            </span>
          </div>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </div>
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("editor.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
