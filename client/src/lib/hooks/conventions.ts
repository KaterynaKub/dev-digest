/* hooks/conventions.ts — React Query hooks for the Conventions extractor.
   Mirrors hooks/skills.ts style: thin wrappers over `api`, no fetch in
   components. Every mutation invalidates ["conventions", repoId] because the
   server returns the WHOLE view (scan + candidates) from extract/bulk — the
   scan subtitle changes with the candidate list, so they cannot be
   invalidated separately without showing a stale sample count. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsView,
  Provider,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsView>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export interface ExtractConventionsInput {
  repoId: string;
  /** Per-scan model choice. BOTH fields or neither — the server ignores a
   *  partial pair rather than mixing it with the workspace override. */
  provider?: Provider;
  model?: string;
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, provider, model }: ExtractConventionsInput) =>
      api.post<ConventionsView>(
        `/repos/${repoId}/conventions/extract`,
        provider && model ? { provider, model } : {},
      ),
    onSuccess: (_data, { repoId }) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: { rule?: string; category?: string; status?: ConventionStatus };
}

export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (_data, { repoId }) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface BulkConventionInput {
  repoId: string;
  status: ConventionStatus;
  /** Omit to target every PENDING candidate — what "Accept all" / "Reject all" mean. */
  ids?: string[];
}

export function useBulkSetConventionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, status, ids }: BulkConventionInput) =>
      api.post<{ updated: number }>(`/repos/${repoId}/conventions/bulk`, {
        status,
        ...(ids ? { ids } : {}),
      }),
    onSuccess: (_data, { repoId }) =>
      qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/** The server-built merged markdown. Disabled until the modal opens — it is
 *  only meaningful once there is something to merge. */
export function useConventionSkillDraft(
  repoId: string | null | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && (opts?.enabled ?? false),
    staleTime: 0,
  });
}
