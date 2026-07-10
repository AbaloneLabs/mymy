import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateInvestmentAccountInput,
  CreateInvestmentAssetInput,
  CreateInvestmentCashflowInput,
  CreateInvestmentPositionInput,
  CreateInvestmentValuationSnapshotInput,
  CreateInvestmentWatchlistInput,
  InvestmentAccountsResponse,
  InvestmentAssetsResponse,
  InvestmentCashflowsResponse,
  InvestmentPositionsResponse,
  InvestmentSummaryResponse,
  InvestmentValuationSnapshotsResponse,
  InvestmentWatchlistResponse,
} from "@/types/investments";

export function useInvestmentSummary(projectId?: string, scope = "all") {
  return useQuery({
    queryKey: ["investments", "summary", projectId, scope],
    queryFn: () => api.get<InvestmentSummaryResponse>(`/investments/summary?${scopeQuery(projectId, scope)}`),
  });
}

export function useInvestmentAccounts(projectId?: string, scope = "all") {
  return useQuery({
    queryKey: ["investments", "accounts", projectId, scope],
    queryFn: () => api.get<InvestmentAccountsResponse>(`/investments/accounts?${scopeQuery(projectId, scope)}`),
  });
}

export function useInvestmentAssets() {
  return useQuery({
    queryKey: ["investments", "assets"],
    queryFn: () => api.get<InvestmentAssetsResponse>("/investments/assets"),
  });
}

export function useInvestmentPositions(projectId?: string, scope = "all") {
  return useQuery({
    queryKey: ["investments", "positions", projectId, scope],
    queryFn: () => api.get<InvestmentPositionsResponse>(`/investments/positions?${scopeQuery(projectId, scope)}`),
  });
}

export function useInvestmentValuationSnapshots(positionId?: string | null) {
  const query = positionId ? `?positionId=${encodeURIComponent(positionId)}` : "";
  return useQuery({
    queryKey: ["investments", "valuation-snapshots", positionId ?? "all"],
    queryFn: () =>
      api.get<InvestmentValuationSnapshotsResponse>(
        `/investments/valuation-snapshots${query}`,
      ),
  });
}

export function useInvestmentCashflows(projectId?: string, scope = "all") {
  return useQuery({
    queryKey: ["investments", "cashflows", projectId, scope],
    queryFn: () =>
      api.get<InvestmentCashflowsResponse>(`/investments/cashflows?${scopeQuery(projectId, scope)}`),
  });
}

export function useInvestmentWatchlist() {
  return useQuery({
    queryKey: ["investments", "watchlist"],
    queryFn: () =>
      api.get<InvestmentWatchlistResponse>("/investments/watchlist"),
  });
}

export function useCreateInvestmentAccount() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentAccountInput) =>
      api.post("/investments/accounts", body),
    onSuccess: qc,
  });
}

export function useCreateInvestmentAsset() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentAssetInput) =>
      api.post("/investments/assets", body),
    onSuccess: qc,
  });
}

export function useCreateInvestmentPosition() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentPositionInput) =>
      api.post("/investments/positions", body),
    onSuccess: qc,
  });
}

export function useCreateInvestmentValuationSnapshot() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentValuationSnapshotInput) =>
      api.post("/investments/valuation-snapshots", body),
    onSuccess: qc,
  });
}

export function useCreateInvestmentCashflow() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentCashflowInput) =>
      api.post("/investments/cashflows", body),
    onSuccess: qc,
  });
}

export function useCreateInvestmentWatchlistItem() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (body: CreateInvestmentWatchlistInput) =>
      api.post("/investments/watchlist", body),
    onSuccess: qc,
  });
}

export function useDeleteInvestmentPosition() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/investments/positions/${id}`),
    onSuccess: qc,
  });
}

export function useDeleteInvestmentAccount() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/investments/accounts/${id}`),
    onSuccess: qc,
  });
}

export function useDeleteInvestmentAsset() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/investments/assets/${id}`),
    onSuccess: qc,
  });
}

export function useDeleteInvestmentCashflow() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/investments/cashflows/${id}`),
    onSuccess: qc,
  });
}

export function useDeleteInvestmentWatchlistItem() {
  const qc = useInvestmentInvalidator();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/investments/watchlist/${id}`),
    onSuccess: qc,
  });
}

function useInvestmentInvalidator() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["investments"] });
  };
}

function scopeQuery(projectId: string | undefined, scope: string) {
  const params = new URLSearchParams();
  if (projectId) {
    params.set("scope", "project");
    params.set("projectId", projectId);
  } else {
    params.set("scope", scope);
  }
  return params.toString();
}
