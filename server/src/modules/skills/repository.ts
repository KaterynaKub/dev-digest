import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions` outright, plus the
 * READ side of `agent_skills` (`skillsForAgents` / `countsByAgent`) — the
 * WRITE side (link/reorder) stays owned by `modules/agents` (its
 * `linkSkill`/`setSkills`). Two repositories over one join table is fine:
 * `no-cross-module-service` only forbids importing another module's
 * `service.ts`/`routes.ts`, not sharing a table. Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface AgentSkillCount {
  agentId: string;
  count: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND record body version 1 in skill_versions. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. ONLY a `body` change bumps `version` and snapshots
   * `skill_versions` — see `isBodyChange` / the module CLAUDE.md for why this
   * is narrower than the agents' "any config field bumps" rule.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions + agent_skills links
   *  cascade via FK. Returns false if no such skill existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- agent_skills (read side — skills owns this half) --------------------

  /** Skills linked to a set of agents, in `agent_skills.order` ascending per
   *  agent. Used by `../reviews/run-executor.ts` to build prompt sections in
   *  link order without re-sorting downstream. */
  async skillsForAgents(agentIds: string[]): Promise<Map<string, SkillRow[]>> {
    if (agentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ agentId: t.agentSkills.agentId, skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(inArray(t.agentSkills.agentId, agentIds))
      .orderBy(t.agentSkills.agentId, t.agentSkills.order);

    const byAgent = new Map<string, SkillRow[]>();
    for (const row of rows) {
      const list = byAgent.get(row.agentId) ?? [];
      list.push(row.skill);
      byAgent.set(row.agentId, list);
    }
    return byAgent;
  }

  /** Linked-skill count per agent, one grouped query (not N calls) — backs
   *  `GET /agents/skill-counts` (the "sleeping" `skillCount` on `AgentCard`). */
  async countsByAgent(workspaceId: string): Promise<AgentSkillCount[]> {
    const rows = await this.db
      .select({ agentId: t.agentSkills.agentId, count: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentSkills.agentId);
    return rows.map((r) => ({ agentId: r.agentId, count: r.count }));
  }
}
