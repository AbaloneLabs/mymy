/**
 * TanStack Query hooks for this domain.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Agent, AgentToolPermission } from "@/types/agents";

/* -------------------------------------------------- Agents */

interface AgentsResponse {
  agents: Agent[];
}

interface AgentResponse {
  agent: Agent;
}

export interface CreateAgentRequest {
  profile?: string;
  name: string;
  role?: string;
  description?: string;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
  description?: string;
  toolPermissions?: AgentToolPermission[];
  llmSettings?: {
    providerId: string | null;
    model: string | null;
  };
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentsResponse>("/agents"),
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentRequest) =>
      api.post<AgentResponse>("/agents", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: string) =>
      api.delete<{ success: boolean }>(`/agents/${encodeURIComponent(profile)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      profile,
      body,
    }: {
      profile: string;
      body: UpdateAgentRequest;
    }) =>
      api.patch<AgentResponse>(`/agents/${encodeURIComponent(profile)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}
