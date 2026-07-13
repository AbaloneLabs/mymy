/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateGoalInput, CreateKeyResultInput, Goal, GoalStatus, GoalType, KeyResult, UpdateGoalInput, UpdateKeyResultInput } from "@/types/goals";

/* -------------------------------------------------- Goals / OKR */

interface GoalsResponse {
  goals: Goal[];
}

/**
 * Fetch goals with optional filters.
 *
 * @param type   Filter by period type (quarterly/annual/monthly).
 * @param status Filter by status (active/completed/archived).
 * @param period Filter by period label (e.g. "2026-Q3").
 */
export function useGoals(
  type?: GoalType,
  status?: GoalStatus,
  period?: string,
) {
  return useQuery({
    queryKey: ["goals", type ?? "all", status ?? "all", period ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      if (period) params.set("period", period);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<GoalsResponse>(`/goals${qs}`);
    },
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGoalInput) =>
      api.post<{ goal: Goal }>("/goals", {
        title: body.title,
        description: body.description ?? null,
        type: body.type ?? null,
        period: body.period ?? null,
        status: body.status ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateGoalInput }) =>
      api.patch<{ goal: Goal }>(`/goals/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useCreateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { goalId: string; body: CreateKeyResultInput }) =>
      api.post<{ keyResult: KeyResult }>(
        `/goals/${vars.goalId}/key-results`,
        {
          title: vars.body.title,
          kpiType: vars.body.kpiType ?? null,
          targetValue: vars.body.targetValue ?? null,
          currentValue: vars.body.currentValue ?? null,
          unit: vars.body.unit ?? null,
          financeDefinition: vars.body.financeDefinition ?? null,
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useUpdateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      goalId: string;
      krId: string;
      body: UpdateKeyResultInput;
    }) =>
      api.patch<{ keyResult: KeyResult }>(
        `/goals/${vars.goalId}/key-results/${vars.krId}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { goalId: string; krId: string }) =>
      api.delete<{ success: boolean }>(
        `/goals/${vars.goalId}/key-results/${vars.krId}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * Link a task to a specific key result.
 * The backend also upserts the goal-level link so the goal's
 * task assignment count stays consistent.
 */
export function useLinkTaskToKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { goalId: string; krId: string; taskId: string }) =>
      api.post<{ keyResult: KeyResult }>(
        `/goals/${vars.goalId}/key-results/${vars.krId}/tasks`,
        { taskId: vars.taskId },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

/**
 * Unlink a task from a specific key result.
 * Only removes the KR-scoped link; the goal-level link is preserved.
 */
export function useUnlinkTaskFromKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { goalId: string; krId: string; taskId: string }) =>
      api.delete<{ keyResult: KeyResult }>(
        `/goals/${vars.goalId}/key-results/${vars.krId}/tasks/${vars.taskId}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
