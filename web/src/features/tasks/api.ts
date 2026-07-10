/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTaskInput, Task, UpdateTaskInput } from "@/types/tasks";

/* -------------------------------------------------- Tasks */

interface TasksResponse {
  tasks: Task[];
}

export interface RelatedTaskRun {
  runId: string;
  sessionId?: string;
  agentProfile: string;
  status: string;
  triggerType: string;
  linkKind: string;
  operation?: string;
  outcome?: string;
  createdAt: string;
  completedAt?: string;
}

interface TaskRuntimeResponse {
  taskId: string;
  taskDeleted: boolean;
  activeRunCount: number;
  runs: RelatedTaskRun[];
}

export function useTaskRuntime(taskId: string) {
  return useQuery({
    queryKey: ["tasks", taskId, "runtime"],
    queryFn: () => api.get<TaskRuntimeResponse>(`/tasks/${taskId}/runtime`),
    refetchInterval: 5_000,
  });
}

export function useTasks(
  projectId?: string,
  status?: string,
  scope: "all" | "general" | "project" = projectId ? "project" : "all",
) {
  return useQuery({
    queryKey: ["tasks", scope, projectId ?? "none", status ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (projectId) params.set("projectId", projectId);
      if (status) params.set("status", status);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<TasksResponse>(`/tasks${qs}`);
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskInput) =>
      api.post<{ task: Task }>("/tasks", {
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? null,
        priority: body.priority ?? null,
        dueDate: body.dueDate ?? null,
        projectId: body.projectId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateTaskInput }) =>
      api.patch<{ task: Task }>(`/tasks/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
