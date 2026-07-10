/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateTransactionInput, Transaction, TransactionSummary, TransactionType, UpdateTransactionInput } from "@/types/finance";

/* -------------------------------------------------- Finance (Transactions) */

interface TransactionsResponse {
  transactions: Transaction[];
}

interface TransactionsSummaryResponse {
  summary: TransactionSummary;
}

/**
 * Fetch transactions with optional filters.
 *
 * @param from   ISO date string (inclusive). Start of the period.
 * @param to     ISO date string (exclusive). End of the period.
 * @param type   Filter by income/expense.
 * @param projectId Filter by project.
 */
export function useTransactions(
  from?: string,
  to?: string,
  type?: TransactionType,
  projectId?: string,
  scope: "all" | "general" | "project" = projectId ? "project" : "all",
) {
  return useQuery({
    queryKey: [
      "transactions",
      from ?? "any",
      to ?? "any",
      type ?? "all",
      projectId ?? "all",
      scope,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (type) params.set("type", type);
      if (projectId) params.set("projectId", projectId);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<TransactionsResponse>(`/transactions${qs}`);
    },
  });
}

/**
 * Fetch income/expense/net summary for a period.
 * Uses the same filter keys as useTransactions so both stay in sync.
 */
export function useTransactionsSummary(
  from?: string,
  to?: string,
  projectId?: string,
  scope: "all" | "general" | "project" = projectId ? "project" : "all",
) {
  return useQuery({
    queryKey: [
      "transactions",
      "summary",
      from ?? "any",
      to ?? "any",
      projectId ?? "all",
      scope,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (projectId) params.set("projectId", projectId);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<TransactionsSummaryResponse>(`/transactions/summary${qs}`);
    },
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTransactionInput) =>
      api.post<{ transaction: Transaction }>("/transactions", {
        type: body.type,
        amount: body.amount,
        date: body.date,
        currency: body.currency ?? null,
        category: body.category ?? null,
        description: body.description ?? null,
        status: body.status ?? null,
        projectId: body.projectId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateTransactionInput }) =>
      api.patch<{ transaction: Transaction }>(
        `/transactions/${vars.id}`,
        vars.body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/transactions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
  });
}
