import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DecisionStatus =
  | "pending"
  | "resolved"
  | "dismissed"
  | "expired"
  | "cancelled"
  | "superseded";

export type DecisionKind = "choice" | "input";

export interface Decision {
  id: string;
  runId: string;
  sessionId?: string;
  cronJobId?: string;
  kind: DecisionKind;
  context: string;
  reason: string;
  question: string;
  choices: unknown;
  suspend: boolean;
  status: DecisionStatus;
  answer?: unknown;
  expiresAt?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface DecisionFilters {
  status?: DecisionStatus;
  kind?: DecisionKind;
  blocking?: boolean;
  agentProfile?: string;
  projectId?: string;
}

export interface DecisionsResponse {
  decisions: Decision[];
  nextCursor?: string;
  filteredPendingCount: number;
}

interface ResolveDecisionResponse {
  decision: Decision;
  applied: boolean;
}

interface PendingCountResponse {
  count: number;
  observedAt: string;
}

function decisionsQuery(filters: DecisionFilters, cursor?: string) {
  // A bounded first page keeps the inbox responsive when autonomous agents
  // accumulate many Decisions and makes pagination behavior part of ordinary
  // product operation instead of a release-only fixture path.
  const query = new URLSearchParams({ limit: "10" });
  if (filters.status) query.set("status", filters.status);
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.blocking !== undefined) {
    query.set("blocking", String(filters.blocking));
  }
  if (filters.agentProfile) query.set("agentProfile", filters.agentProfile);
  if (filters.projectId) query.set("projectId", filters.projectId);
  if (cursor) query.set("cursor", cursor);
  return query;
}

export function useDecisions(filters: DecisionFilters) {
  return useInfiniteQuery({
    queryKey: ["decisions", "list", filters],
    queryFn: ({ pageParam }) =>
      api.get<DecisionsResponse>(
        `/decisions?${decisionsQuery(filters, pageParam).toString()}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

export function useDecision(id: string | null) {
  return useQuery({
    queryKey: ["decisions", "detail", id],
    queryFn: () => api.get<{ decision: Decision }>(`/decisions/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function usePendingDecisionCount() {
  return useQuery({
    queryKey: ["decisions", "pending-count"],
    queryFn: () => api.get<PendingCountResponse>("/decisions/pending-count"),
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

function invalidateDecisionState(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["decisions"] });
  void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
}

export function useResolveDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["decisions", "resolve"],
    mutationFn: ({ id, answer }: { id: string; answer: unknown }) =>
      api.post<ResolveDecisionResponse>(
        `/decisions/${encodeURIComponent(id)}/resolve`,
        { answer },
      ),
    onSuccess: () => invalidateDecisionState(queryClient),
    onError: () => invalidateDecisionState(queryClient),
  });
}

export function useDismissDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["decisions", "dismiss"],
    mutationFn: (id: string) =>
      api.post<ResolveDecisionResponse>(
        `/decisions/${encodeURIComponent(id)}/dismiss`,
      ),
    onSuccess: () => invalidateDecisionState(queryClient),
    onError: () => invalidateDecisionState(queryClient),
  });
}
