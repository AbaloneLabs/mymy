import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import {
  format,
} from "date-fns";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type {
  Transaction,
  TransactionStatus,
  TransactionType,
  UpdateTransactionInput,
} from "@/types/finance";

/* ------------------------------------------------------------------ */
/* Summary card                                                        */
/* ------------------------------------------------------------------ */

export function SummaryCard({
  label,
  amount,
  icon,
  tone,
}: {
  label: string;
  amount: number;
  icon: ReactNode;
  tone: "success" | "error";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
        <span
          className={cn(
            tone === "success" ? "text-[var(--status-success)]" : "text-[var(--status-error)]",
          )}
        >
          {icon}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums",
          tone === "success" ? "text-[var(--status-success)]" : "text-[var(--status-error)]",
        )}
      >
        {formatAmount(amount)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transaction row with inline edit                                    */
/* ------------------------------------------------------------------ */

export function TransactionRow({
  tx,
  onUpdate,
  onDelete,
}: {
  tx: Transaction;
  onUpdate: (body: UpdateTransactionInput) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const isIncome = tx.type === "income";

  function handleToggleStatus() {
    const next: TransactionStatus = tx.status === "cleared" ? "pending" : "cleared";
    onUpdate({ status: next });
  }

  return (
    <li>
      <div className="flex items-center gap-3 py-3">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--text-secondary)] hover:text-[var(--text)]"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Type indicator */}
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full",
            isIncome
              ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
              : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
          )}
        >
          {isIncome ? (
            <ArrowDownLeft className="h-4 w-4" />
          ) : (
            <ArrowUpRight className="h-4 w-4" />
          )}
        </span>

        {/* Description + meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {tx.description || t("finance.untitled")}
          </p>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>{format(parseDate(tx.date), "yyyy-MM-dd")}</span>
            {tx.category && (
              <>
                <span>·</span>
                <span>{tx.category}</span>
              </>
            )}
            <span>·</span>
            <button
              type="button"
              onClick={handleToggleStatus}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase transition-colors",
                tx.status === "cleared"
                  ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
                  : "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
              )}
            >
              {t(`finance.status.${tx.status}`)}
            </button>
          </div>
        </div>

        {/* Amount */}
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            isIncome ? "text-[var(--status-success)]" : "text-[var(--status-error)]",
          )}
        >
          {isIncome ? "+" : "−"}
          {formatAmount(tx.amount)}
        </span>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-[var(--status-error)] group-hover:opacity-100"
          title={t("finance.delete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Inline edit panel */}
      {expanded && (
        <EditPanel tx={tx} onUpdate={onUpdate} onDelete={onDelete} />
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Inline edit panel                                                   */
/* ------------------------------------------------------------------ */

function EditPanel({
  tx,
  onUpdate,
  onDelete,
}: {
  tx: Transaction;
  onUpdate: (body: UpdateTransactionInput) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(tx.description);
  const [category, setCategory] = useState(tx.category);
  const [amount, setAmount] = useState(String(tx.amount));
  const [type, setType] = useState<TransactionType>(tx.type);
  const [date, setDate] = useState(format(parseDate(tx.date), "yyyy-MM-dd"));

  function handleSave() {
    const amt = parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt <= 0) return;
    onUpdate({
      description,
      category,
      amount: amt,
      type,
      date: new Date(date).toISOString(),
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-10 py-4">
      {/* Type */}
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("finance.type")}
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TransactionType)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        >
          <option value="expense">{t("finance.expense")}</option>
          <option value="income">{t("finance.income")}</option>
        </select>
      </label>

      {/* Amount */}
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("finance.amount")}
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm tabular-nums"
        />
      </label>

      {/* Date */}
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("finance.date")}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
      </label>

      {/* Category */}
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("finance.category")}
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("finance.categoryPlaceholder")}
          className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
      </label>

      {/* Description */}
      <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("finance.description")}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={handleSave}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
      >
        {t("finance.save")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--surface-hover)]"
      >
        <Trash2 className="h-4 w-4" />
        {t("finance.delete")}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Format an amount (minimum currency unit integer) for display.
 * v1 assumes KRW — no decimals, thousands separators.
 * TODO(backend): localize currency formatting once multi-currency lands.
 */
function formatAmount(amount: number): string {
  const abs = Math.abs(amount);
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(abs);
}

/** Parse an ISO date string into a Date, guarding against invalid input. */
function parseDate(iso: string): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
