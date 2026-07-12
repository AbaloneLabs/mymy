/**
 * TanStack Query hooks for this domain.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  WorkspaceSearchDomain,
  WorkspaceSearchResponse,
  WorkspaceSearchScope,
} from "@/types/search";

/* -------------------------------------------------- OmniSearch */

/**
 * User OmniSearch over the same normalized domain adapters used by agent
 * workspace discovery. The server derives the local-owner/auth-session
 * principal; browser code supplies only the visible project context.
 *
 * @param query     The (already debounced) search term. Empty/whitespace
 *                  disables the query.
 * @param projectId Optional project scope filter.
 * @param enabled   Whether the dropdown currently permits a request.
 * @param limit     Maximum merged results in the first atomic response.
 */
export function useOmniSearch(
  query: string,
  projectId?: string | null,
  enabled = true,
  limit = 20,
) {
  const scope: WorkspaceSearchScope = projectId
    ? "current_plus_global"
    : "all_permitted";
  const domains: WorkspaceSearchDomain[] = [
    "sessions",
    "tasks",
    "notes",
    "knowledge",
    "drive",
    "projects",
    "calendar",
  ];
  return useQuery({
    queryKey: ["workspace-search", query, projectId ?? "all", limit],
    queryFn: ({ signal }) =>
      api.post<WorkspaceSearchResponse>(
        "/search/workspace",
        {
          query,
          domains,
          scope,
          projectId: projectId ?? null,
          limit,
          cursor: null,
        },
        { signal },
      ),
    enabled: enabled && query.trim().length > 0,
    staleTime: 0,
    gcTime: 0,
  });
}
