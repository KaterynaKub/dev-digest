/* SkillsTab — attach/detach and order the skills an agent runs with.

   ONE list holds every skill in the library: the attached ones first, in
   prompt order, then the unattached ones. The checkbox is the attach control
   (NOT the skill's global `enabled` flag — that lives in the Skills library),
   and both attaching and reordering save immediately: `setSkills` replaces the
   agent's whole linked set server-side, so every save sends the complete
   array rather than a delta.

   Reordering is native HTML5 drag-and-drop (no DnD library in this project),
   with the ▲/▼ buttons kept as the keyboard path — a drag handle alone is
   unreachable without a pointer.

   Callers must pass `key={agent.id}` (done by AgentEditor) so switching agents
   re-seeds this state from the new agent's links instead of carrying over the
   previous agent's list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ROW_ICON_SIZE, TYPE_BG, TYPE_COLOR } from "./constants";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const toast = useToast();
  const { data: links } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const setAgentSkills = useSetAgentSkills();

  // Seeded once from the loaded links; `null` while links haven't arrived yet
  // keeps the initial render from flashing every row as unattached.
  const [linkedIds, setLinkedIds] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (links && linkedIds === null) {
      setLinkedIds([...links].sort((a, b) => a.order - b.order).map((l) => l.skill_id));
    }
  }, [links, linkedIds]);

  const [filter, setFilter] = React.useState("");
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = React.useState<string | null>(null);
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  // Focus keeps the reorder buttons visible for keyboard users, who never
  // produce the hover that reveals them.
  const [focusId, setFocusId] = React.useState<string | null>(null);

  const ids = React.useMemo(() => linkedIds ?? [], [linkedIds]);

  const skillsById = React.useMemo(
    () => new Map((allSkills ?? []).map((sk) => [sk.id, sk])),
    [allSkills],
  );

  // Attached first (in prompt order), then the rest — one list, as designed.
  const ordered = React.useMemo(() => {
    const linked = ids
      .map((id) => skillsById.get(id))
      .filter((sk): sk is Skill => !!sk);
    const rest = (allSkills ?? []).filter((sk) => !ids.includes(sk.id));
    return [...linked, ...rest];
  }, [ids, skillsById, allSkills]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? ordered.filter((sk) => `${sk.name} ${sk.description}`.toLowerCase().includes(needle))
    : ordered;

  const linkedCount = ids.filter((id) => skillsById.has(id)).length;
  const hasDisabledLinked = ids.some((id) => skillsById.get(id)?.enabled === false);

  /** Every mutation goes through here: state and server never diverge, and the
      full array is what `setSkills` expects. */
  const commit = (next: string[]) => {
    setLinkedIds(next);
    setAgentSkills.mutate(
      { agentId: agent.id, skillIds: next },
      { onSuccess: () => toast.success(t("skills.savedToast")) },
    );
  };

  const toggle = (id: string) => {
    commit(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[i] = b;
    next[j] = a;
    commit(next);
  };

  /** Drop `dragged` immediately before `targetId`, or at the end when the
      target is null. Only attached skills participate — an unattached row has
      no position in the prompt to move to. */
  const drop = (targetId: string | null) => {
    const dragged = draggingId;
    setDraggingId(null);
    setDropBeforeId(null);
    if (!dragged || !ids.includes(dragged) || dragged === targetId) return;
    const without = ids.filter((x) => x !== dragged);
    const at = targetId ? without.indexOf(targetId) : -1;
    const next = at < 0 ? [...without, dragged] : [...without.slice(0, at), dragged, ...without.slice(at)];
    commit(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedCount, total: allSkills?.length ?? 0 })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={ROW_ICON_SIZE} style={s.searchIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.hint}>{t("skills.orderHint")}</div>

      {visible.length === 0 && <div style={s.empty}>{t("skills.noneAvailable")}</div>}

      <div style={s.list} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(null)}>
        {visible.map((sk) => {
          const linked = ids.includes(sk.id);
          const i = ids.indexOf(sk.id);
          return (
            <div
              key={sk.id}
              draggable={linked}
              onDragStart={() => setDraggingId(sk.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setDropBeforeId(null);
              }}
              onDragOver={(e) => {
                if (!draggingId || !linked) return;
                e.preventDefault();
                setDropBeforeId(sk.id);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                drop(sk.id);
              }}
              onMouseEnter={() => setHoverId(sk.id)}
              onMouseLeave={() => setHoverId((cur) => (cur === sk.id ? null : cur))}
              onFocus={() => setFocusId(sk.id)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setFocusId((cur) => (cur === sk.id ? null : cur));
                }
              }}
              style={s.row(linked, draggingId === sk.id, dropBeforeId === sk.id)}
            >
              <span style={s.handle} aria-hidden="true">
                <Icon.Menu size={ROW_ICON_SIZE} />
              </span>
              <button
                type="button"
                role="checkbox"
                aria-checked={linked}
                aria-label={sk.name}
                onClick={() => toggle(sk.id)}
                style={s.checkbox(linked)}
              >
                {linked && <Icon.Check size={10} style={{ color: "#fff" }} />}
              </button>
              <span className="mono" style={s.rowName(linked)}>
                {sk.name}
              </span>
              {linked && (
                <div style={s.reorderOverlay(hoverId === sk.id || focusId === sk.id)}>
                  <button
                    type="button"
                    aria-label={t("skills.moveUp", { name: sk.name })}
                    disabled={i === 0}
                    onClick={() => move(sk.id, -1)}
                    style={s.reorderBtn(i === 0)}
                  >
                    <Icon.ArrowUp size={ROW_ICON_SIZE} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("skills.moveDown", { name: sk.name })}
                    disabled={i === ids.length - 1}
                    onClick={() => move(sk.id, 1)}
                    style={s.reorderBtn(i === ids.length - 1)}
                  >
                    <Icon.ArrowDown size={ROW_ICON_SIZE} />
                  </button>
                </div>
              )}
              <span style={s.typeBadge}>
                <Badge
                  color={TYPE_COLOR[sk.type] ?? "var(--text-secondary)"}
                  bg={TYPE_BG[sk.type] ?? "var(--bg-hover)"}
                >
                  {sk.type}
                </Badge>
              </span>
            </div>
          );
        })}
      </div>

      {hasDisabledLinked && (
        <div style={s.disabledWarning}>
          <Icon.AlertTriangle size={12} />
          {t("skills.disabledWarning")}
        </div>
      )}
      <div style={s.savingNote}>{setAgentSkills.isPending ? t("skills.saving") : ""}</div>
    </div>
  );
}
