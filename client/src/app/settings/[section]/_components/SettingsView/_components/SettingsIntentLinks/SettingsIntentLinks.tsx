"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, TextInput } from "@devdigest/ui";
import { useSettings, useUpdateSettings } from "@/lib/hooks";
import { SectionTitle } from "../SectionTitle";
import { INTENT_LINK_PATTERN, MAX_INTENT_LINK_ENTRIES } from "./constants";
import { s } from "./styles";

/**
 * Settings → Models → Intent link allowlist. Reads via `useSettings()`, writes
 * via `useUpdateSettings()` with `{ intent_link_allowlist: [...] }` — no new
 * endpoint (`PUT /settings` already merges known keys). No `fetch` here: all
 * HTTP goes through the hooks in `src/lib/hooks`.
 *
 * The empty state is the point (constraint 16 of the intent-layer spec): an
 * unconfigured workspace fetches ZERO external links during intent
 * derivation, and that must be visible here, not silent.
 */
export function SettingsIntentLinks() {
  const t = useTranslations("settings");
  const { data: settings } = useSettings();
  const update = useUpdateSettings();

  const saved = React.useMemo(() => settings?.intent_link_allowlist ?? [], [settings]);
  const [draft, setDraft] = React.useState<string[]>(saved);
  const [input, setInput] = React.useState("");

  // Re-sync the local draft whenever the server value changes underneath us
  // (e.g. after a successful save, or a fresh load).
  React.useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const trimmedInput = input.trim().toLowerCase();
  const isValidInput = trimmedInput.length > 0 && INTENT_LINK_PATTERN.test(trimmedInput);
  const isDuplicate = draft.includes(trimmedInput);
  const canAdd = isValidInput && !isDuplicate && draft.length < MAX_INTENT_LINK_ENTRIES;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const handleAdd = () => {
    if (!canAdd) return;
    setDraft((prev) => [...prev, trimmedInput]);
    setInput("");
  };

  const handleRemove = (pattern: string) => {
    setDraft((prev) => prev.filter((p) => p !== pattern));
  };

  const handleSave = () => {
    update.mutate({ intent_link_allowlist: draft });
  };

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("intentLinks.title")} body={t("intentLinks.body")} />

      <div style={s.addRow}>
        <div style={s.addInput}>
          <TextInput
            value={input}
            onChange={setInput}
            placeholder={t("intentLinks.placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          {input.trim().length > 0 && !isValidInput && (
            <div style={s.invalidHint}>{t("intentLinks.invalidPattern")}</div>
          )}
          {isDuplicate && isValidInput && <div style={s.invalidHint}>{t("intentLinks.duplicate")}</div>}
        </div>
        <Button kind="secondary" icon="Plus" disabled={!canAdd} onClick={handleAdd}>
          {t("intentLinks.add")}
        </Button>
      </div>

      {draft.length === 0 ? (
        <div style={s.emptyState}>
          <Icon.Info size={15} style={s.emptyStateIcon} />
          <span>{t("intentLinks.empty")}</span>
        </div>
      ) : (
        <div style={s.entryList}>
          {draft.map((pattern) => (
            <div key={pattern} style={s.entryRow}>
              <span className="mono" style={s.entryPattern}>
                {pattern}
              </span>
              <Button kind="ghost" size="sm" icon="X" onClick={() => handleRemove(pattern)}>
                {t("intentLinks.remove")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div style={s.note}>
        <Icon.Info size={15} style={s.noteIcon} />
        <span>{t("intentLinks.wildcardHint")}</span>
      </div>

      <div style={{ ...s.saveRow, marginTop: 14 }}>
        <Button kind="primary" icon="Check" loading={update.isPending} disabled={!dirty} onClick={handleSave}>
          {update.isPending ? t("intentLinks.saving") : t("intentLinks.save")}
        </Button>
      </div>
    </div>
  );
}
