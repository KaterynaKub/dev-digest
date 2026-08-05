/* ScanModelPicker — choose the model for the NEXT scan, without leaving the
   page.

   The choice is per-scan and deliberately NOT persisted: a one-off experiment
   with an expensive model must not silently become the workspace default.
   Changing the default stays in Settings → Feature Models. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SearchableSelect } from "@devdigest/ui";
import { useProviderModels } from "@/lib/hooks/agents";
import { toModelOptions } from "@/lib/model-label";
import { SCAN_PROVIDER } from "./constants";
import { s } from "./styles";

export interface ScanModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  /** True while `value` is still the registry/workspace default. */
  isDefault: boolean;
}

export function ScanModelPicker({ value, onChange, isDefault }: ScanModelPickerProps) {
  const t = useTranslations("conventions");
  const { data: models } = useProviderModels(SCAN_PROVIDER);

  // An empty list AFTER load means the provider key is missing or invalid
  // (listModels failed). Guide the user instead of showing a dropdown with a
  // single silent entry — and leave Re-scan enabled, since the scan can still
  // run on the default model.
  const noModels = models !== undefined && models.length === 0;

  const baseOptions = toModelOptions(models);
  // Keep the current value selectable even when it is not in the live list.
  const options = baseOptions.some((o) => (typeof o === "string" ? o : o.value) === value)
    ? baseOptions
    : [value, ...baseOptions];

  if (noModels) {
    return (
      <div style={s.wrap}>
        <span style={s.note}>{t("page.noModelsNote")}</span>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <span style={s.label}>{t("page.model")}</span>
      <div style={s.select}>
        <SearchableSelect
          value={value}
          onChange={onChange}
          options={options}
          placeholder={t("page.modelSearch")}
        />
      </div>
      {isDefault && <span style={s.defaultTag}>{t("page.usingDefault")}</span>}
    </div>
  );
}
