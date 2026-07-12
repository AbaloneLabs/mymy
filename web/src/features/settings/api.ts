/**
 * TanStack Query hooks for this domain.
 */
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type {
  AppSettings,
  Language,
  QuarantineDecisionResponse,
  QuarantineListResponse,
  SecurityStatus,
} from "@/types/settings";
import { settingsQueryKeys } from "./queryKeys";

/* -------------------------------------------------- Settings */

interface SettingsResponse {
  settings: AppSettings;
}

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKeys.root,
    queryFn: () => api.get<SettingsResponse>("/settings"),
  });
}

export function useUpdateLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (language: Language) =>
      api.patch<{ settings: AppSettings }>("/settings", { language }),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKeys.root }),
  });
}

export function useSecurityStatus() {
  return useQuery({
    queryKey: settingsQueryKeys.security,
    queryFn: () => api.get<SecurityStatus>("/settings/security"),
  });
}

export function usePendingQuarantine() {
  return useInfiniteQuery({
    queryKey: settingsQueryKeys.pendingQuarantine,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: "pending" });
      if (pageParam) params.set("cursor", pageParam);
      return api.get<QuarantineListResponse>(
        `/settings/security/quarantine?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: () =>
      typeof document === "undefined" || document.visibilityState === "visible"
        ? 5_000
        : false,
  });
}

export function useApproveQuarantine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
      destinationPath,
    }: {
      id: string;
      expectedVersion: number;
      destinationPath?: string;
    }) =>
      api.post<QuarantineDecisionResponse>(
        `/settings/security/quarantine/${id}/approve`,
        {
          expectedVersion,
          idempotencyKey: crypto.randomUUID(),
          destinationPath,
        },
      ),
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.quarantine,
      });
      void qc.invalidateQueries({ queryKey: settingsQueryKeys.security });
      void qc.invalidateQueries({ queryKey: ["drive", "list"] });
    },
  });
}

export function useDeleteQuarantine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
      api.delete<QuarantineDecisionResponse>(
        `/settings/security/quarantine/${id}`,
        { expectedVersion },
      ),
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.quarantine,
      });
      void qc.invalidateQueries({ queryKey: settingsQueryKeys.security });
    },
  });
}

export function settingsApiErrorCode(error: unknown) {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") {
    return undefined;
  }
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
