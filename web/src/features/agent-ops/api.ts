/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AgentStatusResponse, CronResponse, EnvironmentResponse, IdentityResponse, MemoryResponse, SessionsResponse, SkillsResponse } from "@/types/agent-ops";

/* -------------------------------------------------- Agent Ops (Hermes) */

/**
 * Fetch cron jobs + scheduler status for an agent system instance.
 * Polls every 30s for near-real-time scheduler status.
 *
 * The `profile` param scopes the query to a specific Hermes profile
 * (e.g. "default", "elena") — this is how the TopBar agent filter works.
 */
export function useCronJobs(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "cron", instanceId, profile],
    queryFn: () =>
      api.get<CronResponse>(`/agent-systems/${instanceId}/cron${params}`),
    enabled: Boolean(instanceId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch gateway + model status for an agent system instance.
 * Polls every 60s.
 */
export function useAgentStatus(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "status", instanceId, profile],
    queryFn: () =>
      api.get<AgentStatusResponse>(
        `/agent-systems/${instanceId}/status${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch recent chat sessions for an agent system instance.
 * Polls every 60s.
 */
export function useAgentSessions(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "sessions", instanceId, profile],
    queryFn: () =>
      api.get<SessionsResponse>(
        `/agent-systems/${instanceId}/sessions${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Delete a Hermes chat session. Delegates to `hermes sessions delete`.
 * On success, invalidates the sessions list so it refetches.
 */
export function useDeleteAgentSession(
  instanceId: string | null,
  profile: string | null,
) {
  const qc = useQueryClient();
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(
        `/agent-systems/${instanceId}/sessions/${sessionId}${params}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["agent-ops", "sessions", instanceId, profile],
      });
    },
  });
}

/**
 * Fetch installed skills for an agent system instance.
 * Polls every 120s (skills rarely change).
 */
export function useAgentSkills(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "skills", instanceId, profile],
    queryFn: () =>
      api.get<SkillsResponse>(
        `/agent-systems/${instanceId}/skills${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch memory status for an agent system instance.
 * Polls every 120s.
 */
export function useAgentMemory(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "memory", instanceId, profile],
    queryFn: () =>
      api.get<MemoryResponse>(
        `/agent-systems/${instanceId}/memory${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch agent identity (SOUL.md) for an agent system instance.
 * Polls every 300s (identity rarely changes).
 */
export function useAgentIdentity(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "identity", instanceId, profile],
    queryFn: () =>
      api.get<IdentityResponse>(
        `/agent-systems/${instanceId}/identity${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch environment (python, model, API keys, auth providers) for an agent system instance.
 * Polls every 120s.
 */
export function useAgentEnvironment(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "environment", instanceId, profile],
    queryFn: () =>
      api.get<EnvironmentResponse>(
        `/agent-systems/${instanceId}/environment${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}
