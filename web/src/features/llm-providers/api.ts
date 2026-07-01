/**
 * TanStack Query hooks for LLM providers.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ApiFormat,
  LlmProvider,
  LlmProviderPreset,
  ModelInfo,
  ModelListSource,
} from "@/types/settings";

/* -------------------------------------------------- LLM Providers */

interface LlmProvidersResponse {
  providers: LlmProvider[];
}

interface CreateLlmProviderRequest {
  label: string;
  api_format: ApiFormat;
  base_url: string;
  api_key: string;
  model: string;
  max_tokens?: number;
  preset?: LlmProviderPreset;
}

interface UpdateLlmProviderRequest {
  label?: string;
  api_format?: ApiFormat;
  base_url?: string;
  /** If provided, replaces the stored key. If omitted, keeps existing. */
  api_key?: string;
  model?: string;
  max_tokens?: number;
  enabled?: boolean;
}

export function useLlmProviders() {
  return useQuery({
    queryKey: ["llm-providers"],
    queryFn: () => api.get<LlmProvidersResponse>("/llm-providers"),
  });
}

export function useCreateLlmProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLlmProviderRequest) =>
      api.post<{ provider: LlmProvider }>("/llm-providers", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });
}

export function useUpdateLlmProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateLlmProviderRequest }) =>
      api.patch<{ provider: LlmProvider }>(
        `/llm-providers/${vars.id}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });
}

export function useDeleteLlmProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/llm-providers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });
}

export function useSetDefaultLlmProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean }>(`/llm-providers/${id}/default`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["llm-providers"] }),
  });
}

interface TestConnectionResponse {
  ok: boolean;
  error?: string;
  latency_ms?: number;
}

/** Test a saved provider's connection (1-token ping). */
export function useTestLlmProvider() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<TestConnectionResponse>(`/llm-providers/${id}/test`),
  });
}

/* -------------------------------------------------- Model Fetch */

interface FetchModelsRequest {
  base_url: string;
  api_key: string;
  api_format: ApiFormat;
}

interface FetchModelsResponse {
  models: ModelInfo[];
  source: ModelListSource;
}

/** Fetch available models from a provider's GET /models endpoint.
 * Works before the provider is saved (accepts raw credentials). */
export function useFetchModels() {
  return useMutation({
    mutationFn: (body: FetchModelsRequest) =>
      api.post<FetchModelsResponse>("/llm-providers/models", body),
  });
}
