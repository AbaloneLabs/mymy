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

export function useInvestmentSummary() {
  return useQuery({
    queryKey: ["investments", "summary"],
    queryFn: () => api.get<InvestmentSummaryResponse>("/investments/summary"),
  });
}

export function useInvestmentAccounts() {
  return useQuery({
    queryKey: ["investments", "accounts"],
    queryFn: () => api.get<InvestmentAccountsResponse>("/investments/accounts"),
  });
}

export function useInvestmentAssets() {
  return useQuery({
    queryKey: ["investments", "assets"],
    queryFn: () => api.get<InvestmentAssetsResponse>("/investments/assets"),
  });
}

export function useInvestmentPositions() {
  return useQuery({
    queryKey: ["investments", "positions"],
    queryFn: () => api.get<InvestmentPositionsResponse>("/investments/positions"),
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

export function useInvestmentCashflows() {
  return useQuery({
    queryKey: ["investments", "cashflows"],
    queryFn: () =>
      api.get<InvestmentCashflowsResponse>("/investments/cashflows"),
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
