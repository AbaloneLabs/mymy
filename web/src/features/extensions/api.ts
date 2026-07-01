import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ExtensionKind = "webhook" | "script" | "mcp_server";

export interface AgentExtension {
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  enabled: boolean;
  parameters: unknown;
  settings: unknown;
  status: ExtensionStatus;
}

export interface ExtensionStatus {
  state: "callable" | "configured" | "disabled" | "error";
  loaded: boolean;
  callable: boolean;
  message?: string;
}

interface ExtensionsResponse {
  extensions: AgentExtension[];
}

interface CreateExtensionRequest {
  kind: ExtensionKind;
  name: string;
  description: string;
  enabled: boolean;
  parameters: unknown;
  settings: unknown;
}

interface UpdateExtensionRequest {
  description?: string;
  enabled?: boolean;
  parameters?: unknown;
  settings?: unknown;
}

interface TestExtensionResponse {
  success: boolean;
  output: unknown;
}

export function useExtensions() {
  return useQuery({
    queryKey: ["extensions"],
    queryFn: () => api.get<ExtensionsResponse>("/extensions"),
  });
}

export function useCreateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExtensionRequest) =>
      api.post<ExtensionsResponse>("/extensions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useUpdateExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateExtensionRequest }) =>
      api.patch<ExtensionsResponse>(`/extensions/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useDeleteExtension() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/extensions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions"] }),
  });
}

export function useTestExtension() {
  return useMutation({
    mutationFn: (vars: { id: string; args: unknown }) =>
      api.post<TestExtensionResponse>(`/extensions/${vars.id}/test`, {
        args: vars.args,
      }),
  });
}
