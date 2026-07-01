import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type JourneyNodeType = "skill" | "memory";

export interface JourneyNode {
  id: string;
  type: JourneyNodeType;
  title: string;
  description: string;
  content: string;
  category?: string | null;
  source: string;
  path?: string | null;
  timestamp?: string | null;
  useCount: number;
  state: string;
  pinned: boolean;
  related: string[];
}

export interface JourneyEdge {
  source: string;
  target: string;
}

export interface JourneyResponse {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  total: number;
}

interface JourneyMutationResponse {
  success: boolean;
  nodeId: string;
  action: string;
}

interface UpdateJourneyNodeRequest {
  content?: string;
  pinned?: boolean;
}

export interface JourneyQuery {
  type?: "all" | "skill" | "memory";
  sort?: "recent" | "usage" | "name";
  neighborhood?: string | null;
}

export function useJourney(query: JourneyQuery) {
  return useQuery({
    queryKey: ["journey", query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.type && query.type !== "all") params.set("type", query.type);
      if (query.sort) params.set("sort", query.sort);
      if (query.neighborhood) params.set("neighborhood", query.neighborhood);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<JourneyResponse>(`/journey${qs}`);
    },
  });
}

export function useUpdateJourneyNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateJourneyNodeRequest }) =>
      api.put<JourneyMutationResponse>(
        `/journey/${encodeURIComponent(vars.id)}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journey"] }),
  });
}

export function useDeleteJourneyNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<JourneyMutationResponse>(`/journey/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journey"] }),
  });
}
