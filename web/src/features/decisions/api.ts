import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DecisionStatus =
  | "pending"
  | "resolved"
  | "dismissed"
  | "expired"
  | "cancelled"
  | "superseded";

export interface Decision {
  id: string;
  runId: string;
  sessionId?: string;
  cronJobId?: string;
  kind: "choice" | "approval" | "input";
  context: string;
  reason: string;
  question: string;
  choices: unknown;
  suspend: boolean;
  status: DecisionStatus;
  answer?: unknown;
  proposedAction?: unknown;
  targetVersion?: string;
  expiresAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface DecisionsResponse {
  decisions: Decision[];
}

interface ResolveDecisionResponse {
  decision: Decision;
  applied: boolean;
}

export function useDecisions(agentProfile: string | null) {
  const query = new URLSearchParams({ limit: "200" });
  if (agentProfile) query.set("agentProfile", agentProfile);
  return useQuery({
    queryKey: ["decisions", agentProfile ?? "all"],
    queryFn: () =>
      api.get<DecisionsResponse>(`/decisions?${query.toString()}`),
    refetchInterval: 5_000,
  });
}

export function useResolveDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: unknown }) =>
      api.post<ResolveDecisionResponse>(
        `/decisions/${encodeURIComponent(id)}/resolve`,
        { answer },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
}

export function useDismissDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ResolveDecisionResponse>(
        `/decisions/${encodeURIComponent(id)}/dismiss`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
}
