/* CreateSkillModal — "Create from scratch" entry point. Mirrors
   CreateAgentModal: a small blocking Modal with name/description/type/body,
   an explicit Create, then a redirect into the full editor. Always saves with
   source: 'manual' — the only source the server does NOT force to disabled. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { DEFAULT_SKILL_TYPE, MODAL_WIDTH, SKILL_TYPES } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_SKILL_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("file.namePlaceholder"),
      description,
      type,
      source: "manual",
      body: body.trim() || "# " + (name.trim() || t("file.namePlaceholder")),
    });
    onClose();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("page.menu.createFromScratch")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("editor.creating") : t("editor.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("editor.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
        </FormField>
        <FormField label={t("editor.description")} hint={t("editor.descriptionHint")} required>
          <Textarea value={description} onChange={setDescription} rows={2} />
        </FormField>
        <FormField label={t("editor.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("editor.body")}>
          <Textarea value={body} onChange={setBody} rows={8} mono placeholder={t("file.bodyPlaceholder")} />
        </FormField>
      </div>
    </Modal>
  );
}
