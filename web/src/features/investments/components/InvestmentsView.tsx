import { Loader2, RefreshCw, WalletCards } from "lucide-react";
import {
  useCreateInvestmentAccount,
  useCreateInvestmentAsset,
  useCreateInvestmentCashflow,
  useCreateInvestmentPosition,
  useCreateInvestmentValuationSnapshot,
  useCreateInvestmentWatchlistItem,
  useDeleteInvestmentAccount,
  useDeleteInvestmentAsset,
  useDeleteInvestmentCashflow,
  useDeleteInvestmentPosition,
  useDeleteInvestmentWatchlistItem,
  useInvestmentAccounts,
  useInvestmentAssets,
  useInvestmentCashflows,
  useInvestmentPositions,
  useInvestmentSummary,
  useInvestmentWatchlist,
} from "@/features/investments/api";
import {
  AccountForm,
  AssetForm,
  CashflowForm,
  PositionForm,
  ValuationForm,
  WatchlistForm,
} from "@/features/investments/components/InvestmentForms";
import {
  AllocationList,
  CashflowList,
  ManagementList,
  Metric,
  Panel,
  PositionTable,
  WatchlistGrid,
} from "@/features/investments/components/InvestmentPanels";
import { money } from "@/features/investments/format";

export function InvestmentsView() {
  const summary = useInvestmentSummary();
  const accounts = useInvestmentAccounts();
  const assets = useInvestmentAssets();
  const positions = useInvestmentPositions();
  const cashflows = useInvestmentCashflows();
  const watchlist = useInvestmentWatchlist();
  const createAccount = useCreateInvestmentAccount();
  const createAsset = useCreateInvestmentAsset();
  const createPosition = useCreateInvestmentPosition();
  const createValuation = useCreateInvestmentValuationSnapshot();
  const createCashflow = useCreateInvestmentCashflow();
  const createWatchlist = useCreateInvestmentWatchlistItem();
  const deleteAccount = useDeleteInvestmentAccount();
  const deleteAsset = useDeleteInvestmentAsset();
  const deletePosition = useDeleteInvestmentPosition();
  const deleteCashflow = useDeleteInvestmentCashflow();
  const deleteWatchlist = useDeleteInvestmentWatchlistItem();

  const accountRows = accounts.data?.accounts ?? [];
  const assetRows = assets.data?.assets ?? [];
  const positionRows = positions.data?.positions ?? [];
  const cashflowRows = cashflows.data?.cashflows ?? [];
  const watchlistRows = watchlist.data?.watchlist ?? [];
  const summaryValue = summary.data?.summary;
  const loading =
    summary.isLoading ||
    accounts.isLoading ||
    assets.isLoading ||
    positions.isLoading ||
    cashflows.isLoading ||
    watchlist.isLoading;

  function refetchAll() {
    summary.refetch();
    accounts.refetch();
    assets.refetch();
    positions.refetch();
    cashflows.refetch();
    watchlist.refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <WalletCards className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
        <h1 className="text-lg font-semibold">투자</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={refetchAll}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          title="새로고침"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        {loading && (
          <div className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            불러오는 중
          </div>
        )}

        <section className="grid gap-3 xl:grid-cols-5">
          <Metric label="평가액" value={money(summaryValue?.marketValueAmount)} />
          <Metric label="기준 금액" value={money(summaryValue?.costBasisAmount)} />
          <Metric
            label="평가 손익"
            value={money(summaryValue?.unrealizedPlAmount)}
            tone={(summaryValue?.unrealizedPlAmount ?? 0) >= 0 ? "good" : "bad"}
          />
          <Metric label="현금흐름" value={money(summaryValue?.netCashflowAmount)} />
          <Metric
            label="보유/관심"
            value={`${summaryValue?.positionCount ?? 0}/${summaryValue?.watchlistCount ?? 0}`}
          />
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="min-w-0 space-y-6">
            <Panel title="보유 자산" count={positionRows.length}>
              <PositionTable
                positions={positionRows}
                onDelete={(id) => deletePosition.mutate(id)}
              />
            </Panel>

            <Panel title="현금흐름" count={cashflowRows.length}>
              <CashflowList
                cashflows={cashflowRows}
                onDelete={(id) => deleteCashflow.mutate(id)}
              />
            </Panel>

            <Panel title="관심 자산" count={watchlistRows.length}>
              <WatchlistGrid
                watchlist={watchlistRows}
                onDelete={(id) => deleteWatchlist.mutate(id)}
              />
            </Panel>

            <Panel title="자산군 비중" count={summaryValue?.allocations.length ?? 0}>
              <AllocationList
                allocations={summaryValue?.allocations ?? []}
                marketValueAmount={summaryValue?.marketValueAmount}
              />
            </Panel>
          </section>

          <aside className="space-y-4">
            <AccountForm
              onSubmit={(body) => createAccount.mutate(body)}
              pending={createAccount.isPending}
            />
            <AssetForm
              onSubmit={(body) => createAsset.mutate(body)}
              pending={createAsset.isPending}
            />
            <PositionForm
              accounts={accountRows}
              assets={assetRows}
              onSubmit={(body) => createPosition.mutate(body)}
              pending={createPosition.isPending}
            />
            <ValuationForm
              positions={positionRows}
              onSubmit={(body) => createValuation.mutate(body)}
              pending={createValuation.isPending}
            />
            <CashflowForm
              accounts={accountRows}
              assets={assetRows}
              onSubmit={(body) => createCashflow.mutate(body)}
              pending={createCashflow.isPending}
            />
            <WatchlistForm
              assets={assetRows}
              onSubmit={(body) => createWatchlist.mutate(body)}
              pending={createWatchlist.isPending}
            />
            <Panel title="계좌/자산 관리" count={accountRows.length + assetRows.length}>
              <ManagementList
                accounts={accountRows}
                assets={assetRows}
                onDeleteAccount={(id) => deleteAccount.mutate(id)}
                onDeleteAsset={(id) => deleteAsset.mutate(id)}
              />
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}
