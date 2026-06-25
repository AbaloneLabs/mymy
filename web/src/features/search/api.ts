/**
 * TanStack Query hooks for this domain.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SearchResponse } from "@/types/search";

/* -------------------------------------------------- OmniSearch */

/**
 * Unified full-text search across notes, tasks, projects, calendar events,
 * and chat (sessions + messages).
 *
 * @param query     The (already debounced) search term. Empty/whitespace
 *                  disables the query.
 * @param projectId Optional project scope filter.
 * @param limit     Max results per entity group (default 5).
 */
export function useOmniSearch(
  query: string,
  projectId?: string | null,
  limit = 5,
) {
  return useQuery({
    queryKey: ["search", query, projectId ?? "all", limit],
    queryFn: () => {
      const params = new URLSearchParams({ q: query });
      if (projectId) params.set("projectId", projectId);
      if (limit) params.set("limit", String(limit));
      return api.get<SearchResponse>(`/search?${params.toString()}`);
    },
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  });
}
