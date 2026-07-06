import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BarChart3,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  WalletCards,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
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
import { cn } from "@/lib/utils";
import type {
  InvestmentAccount,
  InvestmentAsset,
  InvestmentPosition,
} from "@/types/investments";

const ASSET_TYPES = [
  "stock",
  "etf",
  "bond",
  "fund",
  "crypto",
  "cash",
  "commodity",
  "real_estate",
  "other",
];

const CASHFLOW_TYPES = [
  "dividend",
  "interest",
  "fee",
  "tax",
  "deposit",
  "withdrawal",
  "adjustment",
  "other",
];

export default function InvestmentsPage() {
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
    <AppLayout>
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
            <Metric label="보유/관심" value={`${summaryValue?.positionCount ?? 0}/${summaryValue?.watchlistCount ?? 0}`} />
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
                <div className="divide-y divide-[var(--border)]">
                  {cashflowRows.map((flow) => (
                    <div key={flow.id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-[var(--text)]">{flow.flowType}</span>
                          {flow.assetSymbol && (
                            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                              {flow.assetSymbol}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                          {flow.notes || "메모 없음"} · {date(flow.recordedAt)}
                        </p>
                      </div>
                      <span className="font-mono text-sm text-[var(--text)]">
                        {money(flow.amount, flow.currency)}
                      </span>
                      <IconButton
                        label="삭제"
                        onClick={() => deleteCashflow.mutate(flow.id)}
                        danger
                      />
                    </div>
                  ))}
                  {cashflowRows.length === 0 && <EmptyLine text="현금흐름 기록이 없습니다." />}
                </div>
              </Panel>

              <Panel title="관심 자산" count={watchlistRows.length}>
                <div className="grid gap-2 md:grid-cols-2">
                  {watchlistRows.map((item) => (
                    <div key={item.id} className="rounded-md border border-[var(--border)] p-3">
                      <div className="flex items-start gap-2">
                        <Eye className="mt-0.5 h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--text)]">
                            {item.assetSymbol} {item.assetName}
                          </p>
                          <p className="mt-1 text-xs text-[var(--text-muted)]">
                            {item.assetType}
                            {item.targetPriceAmount !== undefined
                              ? ` · 목표 ${money(item.targetPriceAmount, item.currency)}`
                              : ""}
                          </p>
                        </div>
                        <IconButton
                          label="삭제"
                          onClick={() => deleteWatchlist.mutate(item.id)}
                          danger
                        />
                      </div>
                    </div>
                  ))}
                  {watchlistRows.length === 0 && <EmptyLine text="관심 자산이 없습니다." />}
                </div>
              </Panel>

              <Panel title="자산군 비중" count={summaryValue?.allocations.length ?? 0}>
                <div className="space-y-2">
                  {(summaryValue?.allocations ?? []).map((slice) => (
                    <div key={slice.label}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--text-muted)]">{slice.label}</span>
                        <span className="font-mono text-[var(--text)]">{money(slice.amount)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-[var(--surface-hover)]">
                        <div
                          className="h-full bg-[var(--accent)]"
                          style={{
                            width: `${allocationWidth(slice.amount, summaryValue?.marketValueAmount)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  {(summaryValue?.allocations.length ?? 0) === 0 && (
                    <EmptyLine text="비중을 계산할 보유 자산이 없습니다." />
                  )}
                </div>
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
    </AppLayout>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          "mt-2 truncate font-mono text-lg font-semibold text-[var(--text)]",
          tone === "good" && "text-[var(--status-success)]",
          tone === "bad" && "text-[var(--status-error)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
          <h2 className="text-sm font-medium text-[var(--text)]">{title}</h2>
        </div>
        {count !== undefined && (
          <span className="text-xs text-[var(--text-muted)]">{count}</span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PositionTable({
  positions,
  onDelete,
}: {
  positions: InvestmentPosition[];
  onDelete: (id: string) => void;
}) {
  if (positions.length === 0) {
    return <EmptyLine text="보유 자산 기록이 없습니다." />;
  }
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs text-[var(--text-muted)]">
          <tr>
            <th className="pb-2 font-medium">자산</th>
            <th className="pb-2 font-medium">계좌</th>
            <th className="pb-2 text-right font-medium">수량</th>
            <th className="pb-2 text-right font-medium">기준 금액</th>
            <th className="pb-2 text-right font-medium">평가액</th>
            <th className="pb-2 text-right font-medium">손익</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {positions.map((position) => {
            const marketValue =
              position.latestMarketValueAmount ?? position.costBasisAmount;
            return (
              <tr key={position.id}>
                <td className="py-2">
                  <div className="font-medium text-[var(--text)]">
                    {position.assetSymbol}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {position.assetName || position.assetType}
                  </div>
                </td>
                <td className="py-2 text-xs text-[var(--text-muted)]">
                  {position.accountName ?? "미지정"}
                </td>
                <td className="py-2 text-right font-mono">
                  {formatQuantity(position.quantityMicro)}
                </td>
                <td className="py-2 text-right font-mono">
                  {money(position.costBasisAmount, position.currency)}
                </td>
                <td className="py-2 text-right font-mono">
                  {money(marketValue, position.currency)}
                </td>
                <td
                  className={cn(
                    "py-2 text-right font-mono",
                    position.unrealizedPlAmount >= 0
                      ? "text-[var(--status-success)]"
                      : "text-[var(--status-error)]",
                  )}
                >
                  {money(position.unrealizedPlAmount, position.currency)}
                </td>
                <td className="py-2 text-right">
                  <IconButton
                    label="삭제"
                    onClick={() => onDelete(position.id)}
                    danger
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: { name: string; institution?: string; currency?: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [currency, setCurrency] = useState("KRW");
  return (
    <SmallForm
      title="계좌 추가"
      pending={pending}
      disabled={!name.trim()}
      onSubmit={() => {
        onSubmit({ name: name.trim(), institution: institution.trim(), currency });
        setName("");
        setInstitution("");
      }}
    >
      <Input value={name} onChange={setName} placeholder="계좌명" />
      <Input value={institution} onChange={setInstitution} placeholder="기관/위치" />
      <Input value={currency} onChange={setCurrency} placeholder="통화" />
    </SmallForm>
  );
}

function AssetForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: {
    symbol: string;
    name?: string;
    assetType?: string;
    exchange?: string;
    currency?: string;
  }) => void;
  pending: boolean;
}) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("stock");
  const [exchange, setExchange] = useState("");
  const [currency, setCurrency] = useState("KRW");
  return (
    <SmallForm
      title="자산 추가"
      pending={pending}
      disabled={!symbol.trim()}
      onSubmit={() => {
        onSubmit({
          symbol: symbol.trim(),
          name: name.trim(),
          assetType,
          exchange: exchange.trim(),
          currency,
        });
        setSymbol("");
        setName("");
      }}
    >
      <Input value={symbol} onChange={setSymbol} placeholder="심볼" />
      <Input value={name} onChange={setName} placeholder="이름" />
      <select
        value={assetType}
        onChange={(event) => setAssetType(event.target.value)}
        className={inputClassName}
      >
        {ASSET_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={exchange} onChange={setExchange} placeholder="거래소/분류" />
        <Input value={currency} onChange={setCurrency} placeholder="통화" />
      </div>
    </SmallForm>
  );
}

function PositionForm({
  accounts,
  assets,
  onSubmit,
  pending,
}: {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  onSubmit: (body: {
    accountId?: string;
    assetId: string;
    quantityMicro: number;
    costBasisAmount: number;
    currency?: string;
    notes?: string;
  }) => void;
  pending: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [notes, setNotes] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="보유 자산 기록"
      pending={pending}
      disabled={!assetId || !quantity || !costBasis}
      onSubmit={() => {
        onSubmit({
          accountId: accountId || undefined,
          assetId,
          quantityMicro: parseQuantity(quantity),
          costBasisAmount: parseInteger(costBasis),
          currency: selectedAsset?.currency,
          notes: notes.trim(),
        });
        setQuantity("");
        setCostBasis("");
        setNotes("");
      }}
    >
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputClassName}>
        <option value="">계좌 미지정</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputClassName}>
        <option value="">자산 선택</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} {asset.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={quantity} onChange={setQuantity} placeholder="수량" />
        <Input value={costBasis} onChange={setCostBasis} placeholder="기준 금액" />
      </div>
      <Input value={notes} onChange={setNotes} placeholder="메모" />
    </SmallForm>
  );
}

function ValuationForm({
  positions,
  onSubmit,
  pending,
}: {
  positions: InvestmentPosition[];
  onSubmit: (body: {
    positionId: string;
    unitPriceAmount?: number;
    marketValueAmount: number;
    currency?: string;
    notes?: string;
  }) => void;
  pending: boolean;
}) {
  const [positionId, setPositionId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [marketValue, setMarketValue] = useState("");
  const selectedPosition = positions.find((position) => position.id === positionId);
  return (
    <SmallForm
      title="평가 스냅샷"
      pending={pending}
      disabled={!positionId || !marketValue}
      onSubmit={() => {
        onSubmit({
          positionId,
          unitPriceAmount: unitPrice ? parseInteger(unitPrice) : undefined,
          marketValueAmount: parseInteger(marketValue),
          currency: selectedPosition?.currency,
        });
        setUnitPrice("");
        setMarketValue("");
      }}
    >
      <select value={positionId} onChange={(event) => setPositionId(event.target.value)} className={inputClassName}>
        <option value="">보유 자산 선택</option>
        {positions.map((position) => (
          <option key={position.id} value={position.id}>
            {position.assetSymbol} {position.assetName}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input value={unitPrice} onChange={setUnitPrice} placeholder="단가" />
        <Input value={marketValue} onChange={setMarketValue} placeholder="평가액" />
      </div>
    </SmallForm>
  );
}

function CashflowForm({
  accounts,
  assets,
  onSubmit,
  pending,
}: {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  onSubmit: (body: {
    accountId?: string;
    assetId?: string;
    flowType: string;
    amount: number;
    currency?: string;
    notes?: string;
  }) => void;
  pending: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [flowType, setFlowType] = useState("dividend");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="현금흐름 기록"
      pending={pending}
      disabled={!amount}
      onSubmit={() => {
        onSubmit({
          accountId: accountId || undefined,
          assetId: assetId || undefined,
          flowType,
          amount: parseInteger(amount),
          currency: selectedAsset?.currency,
          notes: notes.trim(),
        });
        setAmount("");
        setNotes("");
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <select value={flowType} onChange={(event) => setFlowType(event.target.value)} className={inputClassName}>
          {CASHFLOW_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <Input value={amount} onChange={setAmount} placeholder="금액" />
      </div>
      <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={inputClassName}>
        <option value="">계좌 미지정</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputClassName}>
        <option value="">자산 미지정</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} {asset.name}
          </option>
        ))}
      </select>
      <Input value={notes} onChange={setNotes} placeholder="메모" />
    </SmallForm>
  );
}

function WatchlistForm({
  assets,
  onSubmit,
  pending,
}: {
  assets: InvestmentAsset[];
  onSubmit: (body: { assetId: string; targetPriceAmount?: number; currency?: string }) => void;
  pending: boolean;
}) {
  const [assetId, setAssetId] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const selectedAsset = assets.find((asset) => asset.id === assetId);
  return (
    <SmallForm
      title="관심 자산 추가"
      pending={pending}
      disabled={!assetId}
      onSubmit={() => {
        onSubmit({
          assetId,
          targetPriceAmount: targetPrice ? parseInteger(targetPrice) : undefined,
          currency: selectedAsset?.currency,
        });
        setTargetPrice("");
      }}
    >
      <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className={inputClassName}>
        <option value="">자산 선택</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.symbol} {asset.name}
          </option>
        ))}
      </select>
      <Input value={targetPrice} onChange={setTargetPrice} placeholder="목표 가격" />
    </SmallForm>
  );
}

function SmallForm({
  title,
  children,
  pending,
  disabled,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  pending: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disabled && !pending) onSubmit();
  }
  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Plus className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
      <button
        type="submit"
        disabled={disabled || pending}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <Plus className="h-4 w-4" strokeWidth={1.5} />}
        추가
      </button>
    </form>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
}

function ManagementList({
  accounts,
  assets,
  onDeleteAccount,
  onDeleteAsset,
}: {
  accounts: InvestmentAccount[];
  assets: InvestmentAsset[];
  onDeleteAccount: (id: string) => void;
  onDeleteAsset: (id: string) => void;
}) {
  const rows = useMemo(
    () => [
      ...accounts.map((account) => ({
        id: account.id,
        type: "계좌",
        label: account.name,
        detail: [account.institution, account.currency].filter(Boolean).join(" · "),
        onDelete: onDeleteAccount,
      })),
      ...assets.map((asset) => ({
        id: asset.id,
        type: "자산",
        label: `${asset.symbol} ${asset.name}`,
        detail: [asset.assetType, asset.exchange, asset.currency].filter(Boolean).join(" · "),
        onDelete: onDeleteAsset,
      })),
    ],
    [accounts, assets, onDeleteAccount, onDeleteAsset],
  );
  if (rows.length === 0) return <EmptyLine text="등록된 계좌/자산이 없습니다." />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.type}:${row.id}`} className="flex items-center gap-2">
          <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
            {row.type}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-[var(--text)]">{row.label}</p>
            <p className="truncate text-xs text-[var(--text-muted)]">{row.detail}</p>
          </div>
          <IconButton label="삭제" onClick={() => row.onDelete(row.id)} danger />
        </div>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
        danger ? "hover:text-[var(--status-error)]" : "hover:text-[var(--text)]",
      )}
      title={label}
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--text-faint)]">
      {text}
    </p>
  );
}

const inputClassName =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]";

function parseInteger(value: string) {
  return Math.max(0, Math.round(Number(value.replace(/,/g, "")) || 0));
}

function parseQuantity(value: string) {
  return Math.max(0, Math.round((Number(value.replace(/,/g, "")) || 0) * 1_000_000));
}

function formatQuantity(value: number) {
  return (value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function money(value?: number, currency = "KRW") {
  const amount = value ?? 0;
  return `${currency} ${amount.toLocaleString()}`;
}

function date(value: string) {
  return new Date(value).toLocaleDateString();
}

function allocationWidth(amount: number, total?: number) {
  if (!total || total <= 0) return 0;
  return Math.max(2, Math.min(100, (amount / total) * 100));
}
