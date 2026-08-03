/* CommunityDrawer — the "Search community skills" panel. The catalog service
   behind it does not exist, so this renders the drawer chrome plus a Coming
   soon state rather than a search box that would always return nothing. It is
   a real drawer (not a disabled menu item) because the menu entry is part of
   the intended Add Skill flow and a dead menu row reads as a bug. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer } from "@devdigest/ui";
import { ComingSoon } from "../SkillDetail/_components/ComingSoon";

export function CommunityDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  return (
    <Drawer width={520} title={t("community.title")} subtitle={t("community.subtitle")} onClose={onClose}>
      <div style={{ padding: "24px 24px 32px" }}>
        <ComingSoon icon="Globe" title={t("community.comingSoon.title")} body={t("community.comingSoon.body")} />
      </div>
    </Drawer>
  );
}
