import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ProactiveSettings {
  agentProfile: string;
  enabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  dailyRunBudget: number;
  maxToolCalls: number;
  maxRuntimeSeconds: number;
  maxTotalTokens: number;
  cooldownHours: number;
  idleFallbackDays: number;
}

export interface ProactiveCandidate {
  id: string;
  agentProfile: string;
  projectId?: string;
  taskId?: string;
  kind: "overdue_task" | "idle_review";
  reason: string;
  score: number;
  status: "discovered" | "approved" | "ignored" | "spawned" | "expired";
  runId?: string;
  cooldownUntil?: string;
  discoveredAt: string;
}

export function useProactiveSettings(profile: string) {
  return useQuery({
    queryKey: ["proactive", "settings", profile],
    queryFn: () =>
      api.get<{ settings: ProactiveSettings }>(
        `/proactive/settings/${encodeURIComponent(profile)}`,
      ),
  });
}

export function useUpdateProactiveSettings(profile: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Omit<ProactiveSettings, "agentProfile">>) =>
      api.put<{ settings: ProactiveSettings }>(
        `/proactive/settings/${encodeURIComponent(profile)}`,
        body,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["proactive", "settings", profile],
      }),
  });
}

export function useProactiveCandidates(profile: string) {
  const query = new URLSearchParams({ agentProfile: profile, limit: "50" });
  return useQuery({
    queryKey: ["proactive", "candidates", profile],
    queryFn: () =>
      api.get<{ candidates: ProactiveCandidate[] }>(
        `/proactive/candidates?${query.toString()}`,
      ),
    refetchInterval: 30_000,
  });
}

function useCandidateAction(action: "approve" | "ignore") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ProactiveCandidate>(
        `/proactive/candidates/${encodeURIComponent(id)}/${action}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["proactive", "candidates"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
}

export function useApproveProactiveCandidate() {
  return useCandidateAction("approve");
}

export function useIgnoreProactiveCandidate() {
  return useCandidateAction("ignore");
}
