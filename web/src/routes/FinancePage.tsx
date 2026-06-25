import { useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useProjectContext } from "@/store/projectContext";
import {
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useTransactionsSummary,
  useUpdateTransaction,
} from "@/features/finance/api";
import {
  SummaryCard,
  TransactionRow,
} from "@/features/finance/components/FinanceViews";
import {
  PERIODS,
  computePeriod,
  type PeriodFilter,
} from "@/features/finance/periods";
import { cn } from "@/lib/utils";
import type { CreateTransactionInput, TransactionType } from "@/types/finance";


export default function FinancePage() {
  const { t } = useTranslation();
  const { selectedProjectId } = useProjectContext();

  const [period, setPeriod] = useState<PeriodFilter>("month");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<TransactionType>("expense");
  const [newAmount, setNewAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  // Compute the [from, to] window from the selected period.
  const { from, to } = useMemo(() => computePeriod(period), [period]);

  const { data, isLoading } = useTransactions(from, to, undefined, selectedProjectId ?? undefined);
  const { data: summaryData } = useTransactionsSummary(from, to, selectedProjectId ?? undefined);
  const transactions = data?.transactions ?? [];
  const summary = summaryData?.summary ?? { income: 0, expense: 0, net: 0, count: 0 };

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();

  // --- Create -----------------------------------------------------------

  function handleCreate() {
    const amount = parseInt(newAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCreateError(true);
      return;
    }
    setCreateError(false);
    setCreating(true);
    const body: CreateTransactionInput = {
      type: newType,
      amount,
      date: new Date().toISOString(),
      description: newTitle.trim() || undefined,
      projectId: selectedProjectId ?? undefined,
    };
    createTx.mutate(body, {
      onSuccess: () => {
        setNewTitle("");
        setNewAmount("");
        setCreating(false);
      },
      onError: () => {
        setCreating(false);
        setCreateError(true);
      },
    });
  }

  // --- Delete -----------------------------------------------------------

  function handleDelete(id: string) {
    if (window.confirm(t("finance.deleteConfirm"))) {
      deleteTx.mutate(id);
    }
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
            <h1 className="text-lg font-semibold">{t("finance.title")}</h1>
          </div>

          {/* New transaction input */}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setNewType("expense")}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  newType === "expense"
                    ? "bg-[var(--status-error)] text-white"
                    : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                )}
              >
                {t("finance.expense")}
              </button>
              <button
                type="button"
                onClick={() => setNewType("income")}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  newType === "income"
                    ? "bg-[var(--status-success)] text-white"
                    : "bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                )}
              >
                {t("finance.income")}
              </button>
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={t("finance.amountPlaceholder")}
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="w-32 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <input
              type="text"
              placeholder={t("finance.descriptionPlaceholder")}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="min-w-[180px] flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !newAmount}
              className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("finance.add")}
            </button>
            {createError && (
              <span className="text-sm text-[var(--status-error)]">
                {t("finance.createError")}
              </span>
            )}
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  period === p.id
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                )}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </header>

        {/* Summary cards */}
        <section className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
          <SummaryCard
            label={t("finance.income")}
            amount={summary.income}
            icon={<TrendingUp className="h-4 w-4" />}
            tone="success"
          />
          <SummaryCard
            label={t("finance.expense")}
            amount={summary.expense}
            icon={<TrendingDown className="h-4 w-4" />}
            tone="error"
          />
          <SummaryCard
            label={t("finance.net")}
            amount={summary.net}
            icon={<Wallet className="h-4 w-4" />}
            tone={summary.net >= 0 ? "success" : "error"}
          />
        </section>

        {/* Transactions list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
              <Wallet className="mb-3 h-10 w-10 opacity-40" strokeWidth={1} />
              <p className="text-sm">{t("finance.empty")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {transactions.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  onUpdate={(body) => updateTx.mutate({ id: tx.id, body })}
                  onDelete={() => handleDelete(tx.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
