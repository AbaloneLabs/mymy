import { useMemo } from "react";
import type { ReactNode } from "react";
import { BarChart3, Eye, Trash2 } from "lucide-react";
import {
  allocationWidth,
  date,
  formatQuantity,
  money,
} from "@/features/investments/format";
import { cn } from "@/lib/utils";
import type {
  InvestmentAccount,
  InvestmentAllocation,
  InvestmentAsset,
  InvestmentCashflow,
  InvestmentPosition,
  InvestmentWatchlistItem,
} from "@/types/investments";

export function Metric({
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

export function Panel({
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

export function PositionTable({
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

export function CashflowList({
  cashflows,
  onDelete,
}: {
  cashflows: InvestmentCashflow[];
  onDelete: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-[var(--border)]">
      {cashflows.map((flow) => (
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
          <IconButton label="삭제" onClick={() => onDelete(flow.id)} danger />
        </div>
      ))}
      {cashflows.length === 0 && <EmptyLine text="현금흐름 기록이 없습니다." />}
    </div>
  );
}

export function WatchlistGrid({
  watchlist,
  onDelete,
}: {
  watchlist: InvestmentWatchlistItem[];
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {watchlist.map((item) => (
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
            <IconButton label="삭제" onClick={() => onDelete(item.id)} danger />
          </div>
        </div>
      ))}
      {watchlist.length === 0 && <EmptyLine text="관심 자산이 없습니다." />}
    </div>
  );
}

export function AllocationList({
  allocations,
  marketValueAmount,
}: {
  allocations: InvestmentAllocation[];
  marketValueAmount?: number;
}) {
  return (
    <div className="space-y-2">
      {allocations.map((slice) => (
        <div key={slice.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="text-[var(--text-muted)]">{slice.label}</span>
            <span className="font-mono text-[var(--text)]">{money(slice.amount)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-[var(--surface-hover)]">
            <div
              className="h-full bg-[var(--accent)]"
              style={{
                width: `${allocationWidth(slice.amount, marketValueAmount)}%`,
              }}
            />
          </div>
        </div>
      ))}
      {allocations.length === 0 && (
        <EmptyLine text="비중을 계산할 보유 자산이 없습니다." />
      )}
    </div>
  );
}

export function ManagementList({
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
