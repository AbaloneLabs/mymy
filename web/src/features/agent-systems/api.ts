/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AgentSystemInstance } from "@/types/settings";

/* -------------------------------------------------- Agent Systems */

interface AgentSystemsResponse {
  instances: AgentSystemInstance[];
}
interface DiscoverResponse {
  instances: AgentSystemInstance[];
}
interface CreateAgentSystemRequest {
  type: "hermes" | "openclaw";
  label: string;
  enabled?: boolean;
  connection: "local" | "remote";
  cli_path?: string;
  profile_dir?: string;
  host?: string;
  port?: number;
  ssh_user?: string;
  remote_cli_path?: string;
  remote_profile_dir?: string;
}
interface UpdateAgentSystemRequest {
  label?: string;
  enabled?: boolean;
  connection?: "local" | "remote";
  cli_path?: string;
  profile_dir?: string;
  host?: string;
  port?: number;
  ssh_user?: string;
  remote_cli_path?: string;
  remote_profile_dir?: string;
}

export function useAgentSystems() {
  return useQuery({
    queryKey: ["agent-systems"],
    queryFn: () => api.get<AgentSystemsResponse>("/agent-systems"),
  });
}

export function useDiscoverAgentSystems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<DiscoverResponse>("/agent-systems/discover"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-systems"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useCreateAgentSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentSystemRequest) =>
      api.post<{ instance: AgentSystemInstance }>("/agent-systems", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-systems"] }),
  });
}

export function useUpdateAgentSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateAgentSystemRequest }) =>
      api.patch<{ instance: AgentSystemInstance }>(
        `/agent-systems/${vars.id}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-systems"] }),
  });
}

export function useDeleteAgentSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/agent-systems/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-systems"] }),
  });
}
