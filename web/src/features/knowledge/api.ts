/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateKnowledgeArticleInput, KnowledgeArticle, KnowledgeBreadcrumbItem, KnowledgeResource, KnowledgeTreeNode, MoveKnowledgeArticleInput, UpdateKnowledgeArticleInput } from "@/types/knowledge";

/* -------------------------------------------------- Knowledge Base */

interface KnowledgeTreeResponse {
  tree: KnowledgeTreeNode[];
}
interface KnowledgeListResponse {
  articles: KnowledgeArticle[];
}
interface KnowledgeArticleResponse {
  article: KnowledgeArticle;
}
interface KnowledgeBreadcrumbResponse {
  breadcrumb: KnowledgeBreadcrumbItem[];
}

/**
 * Fetch the entire knowledge document tree (root nodes + nested children).
 *
 * `projectId` controls which roots are returned:
 * - undefined  → all nodes (every project + no-project nodes)
 * - "null"     → only nodes with no project
 * - <uuid>     → only nodes of that project
 */
export function useKnowledgeTree(projectId?: string) {
  return useQuery({
    queryKey: ["knowledge", "tree", projectId ?? "all"],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (projectId) qs.set("projectId", projectId);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return api.get<KnowledgeTreeResponse>(`/knowledge${query}`);
    },
  });
}

/** Fetch a flat list of articles with optional filters. */
export function useKnowledgeFlat(params?: {
  status?: string;
  nodeType?: string;
  parentId?: string;
}) {
  return useQuery({
    queryKey: [
      "knowledge",
      "flat",
      params?.status ?? "all",
      params?.nodeType ?? "all",
      params?.parentId ?? "all",
    ],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.nodeType) qs.set("nodeType", params.nodeType);
      if (params?.parentId) qs.set("parentId", params.parentId);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return api.get<KnowledgeListResponse>(`/knowledge/flat${query}`);
    },
  });
}

/** Fetch a single knowledge article by id. */
export function useKnowledgeArticle(id: string | null) {
  return useQuery({
    queryKey: ["knowledge", "article", id],
    queryFn: () => api.get<KnowledgeArticleResponse>(`/knowledge/${id}`),
    enabled: Boolean(id),
  });
}

/** Fetch the breadcrumb path (root → node) for a knowledge article. */
export function useKnowledgeBreadcrumb(id: string | null) {
  return useQuery({
    queryKey: ["knowledge", "breadcrumb", id],
    queryFn: () =>
      api.get<KnowledgeBreadcrumbResponse>(`/knowledge/${id}/breadcrumb`),
    enabled: Boolean(id),
  });
}

/** Full-text search over knowledge articles (title + content). */
export function useSearchKnowledge(query: string) {
  return useQuery({
    queryKey: ["knowledge", "search", query],
    queryFn: () =>
      api.get<KnowledgeListResponse>(
        `/knowledge/search?${new URLSearchParams({ q: query }).toString()}`,
      ),
    enabled: query.trim().length > 0,
  });
}

export function useCreateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKnowledgeArticleInput) =>
      api.post<KnowledgeArticleResponse>("/knowledge", {
        parentId: body.parentId ?? null,
        projectId: body.projectId ?? null,
        nodeType: body.nodeType ?? null,
        title: body.title,
        slug: body.slug ?? null,
        content: body.content ?? null,
        excerpt: body.excerpt ?? null,
        tags: body.tags ?? [],
        status: body.status ?? null,
        sortOrder: body.sortOrder ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useUpdateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateKnowledgeArticleInput }) =>
      api.patch<KnowledgeArticleResponse>(
        `/knowledge/${vars.id}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useMoveKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: MoveKnowledgeArticleInput }) =>
      api.patch<KnowledgeArticleResponse>(
        `/knowledge/${vars.id}/move`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useDeleteKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/knowledge/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useKnowledgeResources(id: string | null) {
  return useQuery({
    queryKey: ["knowledge", "resources", id],
    queryFn: () =>
      api.get<{ resources: KnowledgeResource[] }>(
        `/knowledge/${id}/resources`,
      ),
    enabled: Boolean(id),
  });
}

export function useAttachKnowledgeResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      knowledgeId,
      resourceRef,
    }: {
      knowledgeId: string;
      resourceRef: string;
    }) =>
      api.post<KnowledgeResource>(`/knowledge/${knowledgeId}/resources`, {
        resourceRef,
      }),
    onSuccess: (_resource, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge", "tree"] });
      void queryClient.invalidateQueries({
        queryKey: ["knowledge", "resources", variables.knowledgeId],
      });
    },
  });
}

export function useDetachKnowledgeResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      knowledgeId,
      resourceId,
    }: {
      knowledgeId: string;
      resourceId: string;
    }) =>
      api.delete<{ success: boolean }>(
        `/knowledge/${knowledgeId}/resources/${resourceId}`,
      ),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge", "tree"] });
      void queryClient.invalidateQueries({
        queryKey: ["knowledge", "resources", variables.knowledgeId],
      });
    },
  });
}
