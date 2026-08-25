import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data-access. Owns `agent_context_docs` and
 * `skill_context_docs` outright. Both tables carry `workspace_id` directly
 * (unlike `agent_skills`), so every query is scoped straight off the table —
 * no join to `agents`/`skills` needed for tenancy. `path` is the ONLY
 * document identity stored here (AC-10, NFR-16); document text is always
 * read live from the clone by `service.ts`.
 */

/** One attached document with its persisted order. */
export interface ContextDocRow {
  path: string;
  order: number;
}

/** A doc inherited from an enabled linked skill, tagged with the skill it
 *  came from — consumed by `0001b`'s run-time injection (AC-25/AC-40). */
export interface InheritedContextDocRow extends ContextDocRow {
  skillId: string;
}

/** `listForAgentWithSkills`'s combined view: the agent's own attachments,
 *  followed by attachments inherited from its enabled linked skills, each
 *  already in `order` ascending within its own source (AC-25). */
export interface AgentContextDocsView {
  agent: ContextDocRow[];
  inherited: InheritedContextDocRow[];
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  // ---- agent_context_docs --------------------------------------------------

  async listForAgent(workspaceId: string, agentId: string): Promise<ContextDocRow[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .where(
        and(
          eq(t.agentContextDocs.workspaceId, workspaceId),
          eq(t.agentContextDocs.agentId, agentId),
        ),
      )
      .orderBy(asc(t.agentContextDocs.order));
    return rows;
  }

  /**
   * Replace the full set of attached documents for an agent with `paths`, in
   * one transaction, assigning `order = index` — same shape as
   * `agents/repository.ts#setSkills`. Re-attaching an already-attached path is
   * idempotent (PK on `(agent_id, path)`); callers enforce
   * `MAX_DOCS_PER_ENTITY` BEFORE calling this (service concern, not a DB
   * constraint — see `service.ts`).
   */
  async setForAgent(workspaceId: string, agentId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentContextDocs)
        .where(
          and(
            eq(t.agentContextDocs.workspaceId, workspaceId),
            eq(t.agentContextDocs.agentId, agentId),
          ),
        );
      if (paths.length === 0) return;
      await tx.insert(t.agentContextDocs).values(
        paths.map((path, i) => ({ workspaceId, agentId, path, order: i })),
      );
    });
  }

  // ---- skill_context_docs ---------------------------------------------------

  async listForSkill(workspaceId: string, skillId: string): Promise<ContextDocRow[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(
        and(
          eq(t.skillContextDocs.workspaceId, workspaceId),
          eq(t.skillContextDocs.skillId, skillId),
        ),
      )
      .orderBy(asc(t.skillContextDocs.order));
    return rows;
  }

  /** Skill counterpart of `setForAgent` — same full-replace, same transaction shape. */
  async setForSkill(workspaceId: string, skillId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextDocs)
        .where(
          and(
            eq(t.skillContextDocs.workspaceId, workspaceId),
            eq(t.skillContextDocs.skillId, skillId),
          ),
        );
      if (paths.length === 0) return;
      await tx.insert(t.skillContextDocs).values(
        paths.map((path, i) => ({ workspaceId, skillId, path, order: i })),
      );
    });
  }

  // ---- cross-entity reads ----------------------------------------------------

  /**
   * Number of agents each path is attached to, workspace-scoped (AC-14 — "Used
   * by N agents" shown on the Project Context page). `repoId` is accepted for
   * a future repo-scoped count but unused today: neither attachment table
   * carries a `repo_id` column, since a path's repo is implied by the page the
   * caller is viewing, not stored redundantly per attachment.
   */
  async attachmentCountsByPath(workspaceId: string, _repoId?: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, count: sql<number>`count(*)::int` })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.workspaceId, workspaceId))
      .groupBy(t.agentContextDocs.path);
    return new Map(rows.map((r) => [r.path, r.count]));
  }

  /**
   * The agent's own attachments (in persisted order) plus every attachment of
   * its ENABLED linked skills, in `agent_skills.order` — the ordered input to
   * AC-25/AC-26/AC-29's run-time dedup, consumed by `0001b`. Disabled skills
   * are excluded entirely, matching `run-executor.ts#buildSkillBodies`'
   * existing rule for skill prompt bodies.
   */
  async listForAgentWithSkills(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentContextDocsView> {
    const agent = await this.listForAgent(workspaceId, agentId);

    const skillRows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        skillOrder: t.agentSkills.order,
        path: t.skillContextDocs.path,
        docOrder: t.skillContextDocs.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(
        t.skillContextDocs,
        and(
          eq(t.skillContextDocs.skillId, t.agentSkills.skillId),
          eq(t.skillContextDocs.workspaceId, workspaceId),
        ),
      )
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order), asc(t.skillContextDocs.order));

    const inherited: InheritedContextDocRow[] = skillRows.map((r) => ({
      path: r.path,
      order: r.docOrder,
      skillId: r.skillId,
    }));

    return { agent, inherited };
  }
}
