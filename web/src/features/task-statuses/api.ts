/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTaskStatusInput, ReorderTaskStatusesInput, TaskStatusDef, UpdateTaskStatusInput } from "@/types/task-statuses";

/* -------------------------------------------------- Task Statuses */

interface TaskStatusesResponse {
  statuses: TaskStatusDef[];
}


export function useTaskStatuses() {
  return useQuery({
    queryKey: ["task-statuses"],
    queryFn: () => api.get<TaskStatusesResponse>("/task-statuses"),
  });
}

export function useCreateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskStatusInput) =>
      api.post<{ status: TaskStatusDef }>("/task-statuses", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-statuses"] }),
  });
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; body: UpdateTaskStatusInput }) =>
      api.patch<{ status: TaskStatusDef }>(`/task-statuses/${vars.slug}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-statuses"] }),
  });
}

export function useReorderTaskStatuses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderTaskStatusesInput) =>
      api.post<{ success: boolean }>("/task-statuses/reorder", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-statuses"] }),
  });
}

export function useDeleteTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; reassignTo?: string }) => {
      const qs = vars.reassignTo ? `?reassignTo=${encodeURIComponent(vars.reassignTo)}` : "";
      return api.delete<{ success: boolean }>(`/task-statuses/${vars.slug}${qs}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-statuses"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
