import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  SandboxProcessLogsResponse,
  SandboxProcessResponse,
  SandboxProcessesResponse,
  SandboxRuntimeResponse,
  StartSandboxProcessInput,
  StopSandboxProcessResponse,
} from "@/types/sandbox";

function processQuery(agentProfile?: string | null, projectId?: string | null) {
  const params = new URLSearchParams();
  if (agentProfile) params.set("agentProfile", agentProfile);
  if (projectId) params.set("projectId", projectId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSandboxRuntime() {
  return useQuery({
    queryKey: ["sandbox", "runtime"],
    queryFn: () => api.get<SandboxRuntimeResponse>("/sandbox/runtime"),
  });
}

export function useSandboxProcesses(agentProfile?: string | null, projectId?: string | null) {
  return useQuery({
    queryKey: ["sandbox", "processes", agentProfile ?? "all", projectId ?? "all"],
    queryFn: () =>
      api.get<SandboxProcessesResponse>(
        `/sandbox/processes${processQuery(agentProfile, projectId)}`,
      ),
  });
}

export function useStartSandboxProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartSandboxProcessInput) =>
      api.post<SandboxProcessResponse>("/sandbox/processes", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sandbox", "processes"] });
      qc.invalidateQueries({ queryKey: ["preview-endpoints"] });
    },
  });
}

export function useStopSandboxProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<StopSandboxProcessResponse>(`/sandbox/processes/${id}/stop`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sandbox", "processes"] });
      qc.invalidateQueries({ queryKey: ["preview-endpoints"] });
    },
  });
}

export function useSandboxProcessLogs(id: string | null) {
  return useQuery({
    queryKey: ["sandbox", "process", id, "logs"],
    enabled: Boolean(id),
    refetchInterval: id ? 5000 : false,
    queryFn: () =>
      api.get<SandboxProcessLogsResponse>(`/sandbox/processes/${id}/logs`),
  });
}
