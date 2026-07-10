/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Note } from "@/types/notes";

/* -------------------------------------------------- Notes */

interface NotesResponse {
  notes: Note[];
}
interface CreateNoteRequest {
  title: string;
  content?: string;
  projectId?: string;
}
interface UpdateNoteRequest {
  title?: string;
  content?: string;
  projectId?: string;
}

export function useNotes(
  projectId?: string,
  scope: "all" | "general" | "project" = projectId ? "project" : "all",
) {
  return useQuery({
    queryKey: ["notes", scope, projectId ?? "none"],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (projectId) params.set("projectId", projectId);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<NotesResponse>(`/notes${qs}`);
    },
  });
}

export function useSearchNotes(
  query: string,
  projectId?: string,
  scope: "all" | "general" | "project" = projectId ? "project" : "all",
) {
  return useQuery({
    queryKey: ["notes", "search", scope, projectId ?? "none", query],
    queryFn: () =>
      api.get<NotesResponse>(
        `/notes/search?${new URLSearchParams({
          q: query,
          scope,
          ...(projectId ? { projectId } : {}),
        }).toString()}`,
      ),
    enabled: query.trim().length > 0,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNoteRequest) =>
      api.post<{ note: Note }>("/notes", {
        title: body.title,
        content: body.content ?? null,
        projectId: body.projectId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateNoteRequest }) =>
      api.patch<{ note: Note }>(`/notes/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });
}
