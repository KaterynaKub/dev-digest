import { eq } from 'drizzle-orm';
import {
  FEATURE_MODELS,
  FeatureModelChoice,
  IntentLinkAllowlist,
  ContextRoots,
  type FeatureModelId,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { rowsToSettings } from './helpers.js';

/**
 * Per-feature model configuration.
 *
 * System LLM features (onboarding, intent, risk brief, conformance, conventions)
 * read their provider/model from the workspace's Settings instead of a hardcoded
 * module constant. When the workspace hasn't chosen one, we fall back to the
 * registry default in `FEATURE_MODELS` — which mirrors each module's old
 * constant, so behaviour is unchanged until a model is explicitly picked.
 */

const DEFAULTS = Object.fromEntries(
  FEATURE_MODELS.map((f) => [f.id, { provider: f.defaultProvider, model: f.defaultModel }]),
) as Record<FeatureModelId, FeatureModelChoice>;

/** The registry default (provider+model) for a feature — no DB read. */
export function defaultFeatureModel(id: FeatureModelId): FeatureModelChoice {
  return DEFAULTS[id];
}

/**
 * The workspace's override for `id`, or `undefined` when unset/invalid. Callers
 * that keep their own dynamic default (e.g. conventions) use this directly so
 * that default is preserved; callers with a static default use
 * `resolveFeatureModel` instead.
 */
export async function getFeatureModelOverride(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  const fm = (rowsToSettings(rows) as { feature_models?: Record<string, unknown> }).feature_models;
  const parsed = FeatureModelChoice.safeParse(fm?.[id]);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve `id` to a concrete provider+model: workspace override, else registry default. */
export async function resolveFeatureModel(
  container: Container,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}

/**
 * The workspace's `intent_link_allowlist`, fail-safe-parsed. An invalid
 * stored value (wrong shape, corrupted) is treated as UNSET — i.e. an empty
 * allowlist, which fetches nothing — mirroring this module's existing rule
 * for `feature_models` (see `modules/settings/CLAUDE.md`): fail closed, never
 * "allow everything" and never a 500.
 */
export async function readLinkAllowlist(container: Container, workspaceId: string): Promise<string[]> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  const settings = rowsToSettings(rows) as { intent_link_allowlist?: unknown };
  const parsed = IntentLinkAllowlist.safeParse(settings.intent_link_allowlist);
  return parsed.success ? parsed.data : [];
}

/**
 * Mirrors `SettingsKnown.context_roots`'s own zod default — duplicated here
 * (not imported from `modules/project-context/constants.ts`) because this
 * function must fail open to a value even before that module exists to
 * define one; `project-context` re-exports/reuses this same array.
 */
export const DEFAULT_CONTEXT_ROOTS = ['specs/', 'docs/', 'insights/'];

/**
 * The workspace's `context_roots`, read on every call (AC-45 — no caching, so
 * a settings edit takes effect on the next request). Unlike
 * `readLinkAllowlist`'s fail-CLOSED (empty array), this fails OPEN into
 * `DEFAULT_CONTEXT_ROOTS` (AC-46): an unset or corrupted value must still let
 * listing work, not silently return zero roots. When a stored value exists
 * but fails validation, `rejected: true` is set so `routes.ts` can log a
 * warning (AC-54) — this function has no logger of its own.
 */
export async function readContextRoots(
  container: Container,
  workspaceId: string,
): Promise<{ roots: string[]; rejected: boolean }> {
  const rows = await container.db
    .select({ key: t.settings.key, value: t.settings.value })
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  const settings = rowsToSettings(rows) as { context_roots?: unknown };
  const parsed = ContextRoots.safeParse(settings.context_roots);
  if (parsed.success) return { roots: parsed.data, rejected: false };
  const rejected = settings.context_roots !== undefined;
  return { roots: DEFAULT_CONTEXT_ROOTS, rejected };
}
