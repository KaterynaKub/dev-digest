/* hooks/project-context.ts — React Query hooks for Project Context (0001a/
   0001b server, 0001c client). Mirrors hooks/skills.ts style: thin wrappers
   over `api`, no fetch in components.

   `useContextDoc` deliberately disables caching (`staleTime: 0`, `gcTime: 0`):
   AC-19 forbids reusing a previously-shown token estimate across requests, and
   the estimate arrives in the SAME response as the document body, so any
   cache (even a brief one) would silently reuse a stale number next to fresh
   text.

   `useSaveContextDoc` invalidates BOTH the document (`context-doc`) and the
   dirty-preflight query (`context-dirty`) on success — writing to the working
   tree makes the file dirty (AC-21), so a resync-preflight check made right
   after a save must see the new dirty path, not a cached empty list. */
"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextAttachment, ContextListing } from "@devdigest/shared";

/** One document's content + token estimate (AC-4/AC-15/AC-16/AC-21). Not
    exported from `@devdigest/shared` as a named contract — GET /doc returns
    exactly `ReadDocumentResult` per
    `server/src/modules/project-context/service.ts`. `approximate` marks the
    token count with `≈` (AC-16/AC-17); `dirty` is the working-tree-differs
    signal AC-21's "uncommitted" state renders from. */
export interface ContextDocContent {
  path: string;
  content: string;
  tokens: number;
  approximate: boolean;
  dirty: boolean;
}

export interface WriteContextDocResult {
  ok: boolean;
  reason?: string;
}

// ---- repo-scoped discovery / read / write ----------------------------------

export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/project-context/docs`),
    enabled: !!repoId,
  });
}

export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocContent>(`/repos/${repoId}/project-context/doc?path=${encodeURIComponent(path!)}`),
    enabled: !!repoId && !!path,
    // AC-19 — the token estimate travels with the content on every fetch and
    // must never be served from a cache between requests.
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Summed token estimate for a SET of attached paths (AC-16/AC-17), e.g. the
 * `ContextTab` footer. There is no server endpoint for a subset sum — only
 * the whole-listing `ContextStatus.token_sum` (`useContextDocs`) — so this
 * fires one `/doc?path=` request per attached path in parallel and reduces
 * the results client-side. Same no-cache discipline as `useContextDoc`
 * (AC-19); `approximate` is true if ANY constituent document fell back to the
 * char-based estimate (AC-18).
 */
export function useContextDocsSum(repoId: string | null | undefined, paths: string[]) {
  const results = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["context-doc", repoId, path],
      queryFn: () =>
        api.get<ContextDocContent>(`/repos/${repoId}/project-context/doc?path=${encodeURIComponent(path)}`),
      enabled: !!repoId,
      staleTime: 0,
      gcTime: 0,
    })),
  });

  const pending = results.some((r) => r.isLoading);
  const tokens = results.reduce((sum, r) => sum + (r.data?.tokens ?? 0), 0);
  const approximate = results.some((r) => r.data?.approximate);
  return { tokens, approximate, pending };
}

export function useSaveContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<WriteContextDocResult>(`/repos/${repoId}/project-context/doc`, { path, content }),
    onSuccess: (_result, { path }) => {
      qc.invalidateQueries({ queryKey: ["context-doc", repoId, path] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
      // The write just made this path dirty (AC-21) — a stale empty `dirty`
      // list would let a subsequent resync preflight skip the confirmation.
      qc.invalidateQueries({ queryKey: ["context-dirty", repoId] });
    },
  });
}

/** Preflight for resync/re-index (AC-22/AC-53) — paths under the configured
    roots with uncommitted local edits, already `*.md`-filtered server-side
    (AC-66). Not polled: called on-demand right before a resync attempt. */
export function useDirtyContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-dirty", repoId],
    queryFn: () => api.get<{ paths: string[] }>(`/repos/${repoId}/project-context/dirty`),
    enabled: !!repoId,
  });
}

// ---- agent / skill attachment sets -----------------------------------------

/** `repoId` is optional (AttachmentsQuery on the server) — passing it lets
    `missing` (AC-37) be checked against that repo's clone; omitting it (the
    agent/skill editor is not itself repo-scoped) always resolves `missing:
    false`. */
export function useAgentContextDocs(agentId: string | null | undefined, repoId?: string | null) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId, repoId ?? null],
    queryFn: () =>
      api.get<ContextAttachment[]>(
        `/agents/${agentId}/context-docs${repoId ? `?repoId=${encodeURIComponent(repoId)}` : ""}`,
      ),
    enabled: !!agentId,
  });
}

/** Replace an agent's full attachment set (order = array order), mirroring
    `useSetAgentSkills`' full-replace semantics — NOT an incremental update. */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, paths }: { agentId: string; paths: string[] }) =>
      api.post<ContextAttachment[]>(`/agents/${agentId}/context-docs`, { paths }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId] });
    },
  });
}

export function useSkillContextDocs(skillId: string | null | undefined, repoId?: string | null) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId, repoId ?? null],
    queryFn: () =>
      api.get<ContextAttachment[]>(
        `/skills/${skillId}/context-docs${repoId ? `?repoId=${encodeURIComponent(repoId)}` : ""}`,
      ),
    enabled: !!skillId,
  });
}

export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, paths }: { skillId: string; paths: string[] }) =>
      api.post<ContextAttachment[]>(`/skills/${skillId}/context-docs`, { paths }),
    onSuccess: (_data, { skillId }) => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId] });
    },
  });
}
