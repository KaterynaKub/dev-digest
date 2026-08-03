import type { Skill, SkillDraft, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillsRepository } from './repository.js';
import { parseSkillMarkdown, toSkillDto } from './helpers.js';

/**
 * Skills service. CRUD + version history + stateless import preview.
 *
 * A skill's prompt-visible payload is `body`; `skill_versions` snapshots ONLY
 * that field (see `helpers.isBodyChange` / `modules/skills/CLAUDE.md`).
 * `imported_url` is reused for both a single-file upload and a zip archive —
 * also documented in the module CLAUDE.md.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[] | null;
}

/**
 * Ports this service needs. An explicit object (not a positional arg) so a
 * later archive-reader port can be added without breaking the constructor
 * signature.
 */
export interface SkillsDeps {
  repo: SkillsRepository;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private deps: SkillsDeps) {
    this.repo = deps.repo;
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Create a skill. The vetting gate lives HERE, in exactly one place: any
   * `source` other than 'manual' is forced to `enabled: false` regardless of
   * what the request body asked for — an imported skill is never live until a
   * human reviews and flips it on.
   */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const enabled = input.source === 'manual' ? (input.enabled ?? true) : false;
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source,
      body: input.body,
      enabled,
      evidenceFiles: input.evidence_files ?? null,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill (and its versions/agent-skill links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body-version history for a skill, newest first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (route → 404), so
   * version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map((r) => ({
      skill_id: r.skillId,
      version: r.version,
      body: r.body,
      created_at: r.createdAt.toISOString(),
    }));
  }

  /**
   * A single body snapshot. Returns undefined when the skill isn't in this
   * workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    if (!row) return undefined;
    return {
      skill_id: row.skillId,
      version: row.version,
      body: row.body,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** Linked-skill count per agent — backs `GET /agents/skill-counts`. */
  async countsByAgent(workspaceId: string): Promise<{ agent_id: string; count: number }[]> {
    const rows = await this.repo.countsByAgent(workspaceId);
    return rows.map((r) => ({ agent_id: r.agentId, count: r.count }));
  }

  /**
   * Parse a single markdown file into a `SkillDraft`. STATELESS — nothing is
   * persisted; the caller (route) is responsible for archive dispatch before
   * reaching here (this only ever sees markdown text). Throws (→ 422 at the
   * route) when no description can be extracted.
   */
  previewImport(filename: string, content: string): SkillDraft {
    const fallbackName = filename.replace(/\.[^./\\]+$/, '');
    const parsed = parseSkillMarkdown(content, fallbackName);
    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      source_entry: null,
    };
  }
}
