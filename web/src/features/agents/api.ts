/**
 * TanStack Query hooks for this domain.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Agent } from "@/types/agents";

/* -------------------------------------------------- Agents */

interface AgentsResponse {
  agents: Agent[];
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentsResponse>("/agents"),
  });
}
