import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SessionArtifact {
  id: string;
  resourceId: string;
  artifactType: string;
  title: string;
  mimeType: string;
  lifecycleState: "active" | "trashed" | "purged" | "missing" | "reconciling";
  lifecycleSequence: number;
  relationshipKind: "created" | "modified" | "deleted" | "restored";
  producingAgent?: string;
  currentPath?: string;
  wikiLinks: Array<{ knowledgeId: string; title: string }>;
  lastActivityAt: string;
}

interface SessionArtifactsResponse {
  artifacts: SessionArtifact[];
  nextCursor?: string;
}

export interface ArtifactOpenResponse {
  artifactId: string;
  resourceId: string;
  path: string;
  mimeType: string;
  lifecycleSequence: number;
}

export interface ResourceRunLink {
  runId: string;
  sessionId?: string;
  agentProfile: string;
  effectKind: string;
  resourceSequence: number;
  createdAt: string;
}

export interface ResourceProvenanceResponse {
  resourceId: string;
  lifecycleState: string;
  currentPath?: string;
  runs: ResourceRunLink[];
}

export function useResourceProvenance(resourceId?: string) {
  return useQuery({
    queryKey: ["artifacts", "resource", resourceId, "provenance"],
    enabled: Boolean(resourceId),
    queryFn: () =>
      api.get<ResourceProvenanceResponse>(
        `/drive/resources/${encodeURIComponent(resourceId!)}/provenance`,
      ),
    refetchOnWindowFocus: "always",
  });
}

export function useSessionArtifacts(sessionId: string | null) {
  return useInfiniteQuery({
    queryKey: ["artifacts", "session", sessionId],
    enabled: Boolean(sessionId),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      return api.get<SessionArtifactsResponse>(
        `/chat/sessions/${encodeURIComponent(sessionId!)}/artifacts?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

export function useOpenArtifact() {
  return useMutation({
    mutationKey: ["artifacts", "open"],
    mutationFn: (id: string) =>
      api.get<ArtifactOpenResponse>(`/artifacts/${encodeURIComponent(id)}/open`),
  });
}
