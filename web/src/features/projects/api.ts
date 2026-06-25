/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Project } from "@/types/projects";
import type { GitSystemType } from "@/types/settings";

/* -------------------------------------------------- Projects */

interface ProjectsResponse {
  projects: Project[];
}
interface CreateProjectRequest {
  name: string;
  description?: string;
  gitRemote?: string;
  gitSystem?: GitSystemType;
}
interface UpdateProjectRequest {
  name?: string;
  description?: string;
  gitRemote?: string;
  gitSystem?: GitSystemType;
  status?: "active" | "archived";
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectsResponse>("/projects"),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => api.get<{ project: Project }>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectRequest) =>
      api.post<{ project: Project }>("/projects", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateProjectRequest }) =>
      api.patch<{ project: Project }>(`/projects/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
