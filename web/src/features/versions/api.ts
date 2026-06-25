/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EntityVersion, EntityVersionsResponse, RestoreVersionResponse } from "@/types/versions";

/* -------------------------------------------------- Version History */

/**
 * Fetch the version history (summaries, newest-first) for an entity.
 *
 * @param entityType "note" | "task"
 * @param entityId   The entity's UUID.
 */
export function useEntityVersions(
  entityType: string,
  entityId: string | null,
) {
  return useQuery({
    queryKey: ["versions", entityType, entityId],
    queryFn: () => {
      const qs = new URLSearchParams({
        entityType,
        entityId: entityId!,
      });
      return api.get<EntityVersionsResponse>(`/versions?${qs.toString()}`);
    },
    enabled: Boolean(entityId),
  });
}

/**
 * Fetch a single version including its full JSONB snapshot.
 */
export function useEntityVersion(versionId: string | null) {
  return useQuery({
    queryKey: ["versions", "detail", versionId],
    queryFn: () =>
      api.get<{ version: EntityVersion }>(`/versions/${versionId}`),
    enabled: Boolean(versionId),
  });
}

/**
 * Restore an entity to the state captured in the given version.
 * On success, invalidates the note list + that entity's version list.
 */
export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      versionId: string;
      actorType?: string;
      actorLabel?: string;
    }) =>
      api.post<RestoreVersionResponse>(
        `/versions/${vars.versionId}/restore`,
        {
          actorType: vars.actorType,
          actorLabel: vars.actorLabel,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["versions"] });
    },
  });
}
