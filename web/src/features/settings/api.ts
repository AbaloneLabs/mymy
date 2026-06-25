/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppSettings, Language } from "@/types/settings";

/* -------------------------------------------------- Settings */

interface SettingsResponse {
  settings: AppSettings;
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsResponse>("/settings"),
  });
}

export function useUpdateLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (language: Language) =>
      api.patch<{ settings: AppSettings }>("/settings", { language }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
