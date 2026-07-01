import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MoaPreset {
  id: string;
  name: string;
  enabled: boolean;
  proposerProviderIds: string[];
  aggregatorProviderId: string;
  maxConcurrent: number;
  aggregationPrompt: string;
  createdAt: string;
  updatedAt: string;
}

interface MoaPresetsResponse {
  presets: MoaPreset[];
}

export interface UpsertMoaPresetRequest {
  name: string;
  enabled: boolean;
  proposerProviderIds: string[];
  aggregatorProviderId: string;
  maxConcurrent: number;
  aggregationPrompt: string;
}

export function useMoaPresets() {
  return useQuery({
    queryKey: ["moa", "presets"],
    queryFn: () => api.get<MoaPresetsResponse>("/moa/presets"),
  });
}

export function useCreateMoaPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertMoaPresetRequest) =>
      api.post<{ preset: MoaPreset }>("/moa/presets", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["moa", "presets"] }),
  });
}

export function useUpdateMoaPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<UpsertMoaPresetRequest> }) =>
      api.patch<{ preset: MoaPreset }>(`/moa/presets/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["moa", "presets"] }),
  });
}

export function useDeleteMoaPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/moa/presets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["moa", "presets"] }),
  });
}
