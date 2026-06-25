import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateGoal,
  useCreateKeyResult,
  useDeleteGoal,
  useDeleteKeyResult,
  useUpdateGoal,
  useUpdateKeyResult,
} from "@/features/goals/api";
import { GOAL_TYPES, KPI_TYPES } from "@/features/goals/constants";
import { cn } from "@/lib/utils";
import type {
  CreateGoalInput,
  CreateKeyResultInput,
  Goal,
  GoalStatus,
  GoalType,
  KeyResult,
  KpiType,
} from "@/types/goals";

/* ------------------------------------------------------------------ */
/* Goal card                                                           */
/* ------------------------------------------------------------------ */

export function GoalCard({ goal }: { goal: Goal }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  function handleDelete() {
    if (window.confirm(t("goals.deleteConfirm"))) {
      deleteGoal.mutate(goal.id);
    }
  }

  function handleStatusToggle() {
    const next: GoalStatus =
      goal.status === "active"
        ? "completed"
        : goal.status === "completed"
          ? "archived"
          : "active";
    updateGoal.mutate({ id: goal.id, body: { status: next } });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {/* Card header */}
      <div className="flex items-center gap-3 p-4">
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

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{goal.title}</h3>
            <StatusBadge status={goal.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>{t(`goals.${goal.type}`)}</span>
            <span>·</span>
            <span>{goal.period}</span>
            {goal.description && (
              <>
                <span>·</span>
                <span className="truncate">{goal.description}</span>
              </>
            )}
          </div>
        </div>

        {/* Overall progress */}
        <div className="flex items-center gap-2">
          <div className="hidden w-32 sm:block">
            <ProgressBar value={goal.progress} />
          </div>
          <span className="w-10 text-right text-sm font-semibold tabular-nums">
            {Math.round(goal.progress)}%
          </span>
        </div>

        {/* Actions */}
        <button
          type="button"
          onClick={handleStatusToggle}
          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          title={t("goals.status")}
        >
          {t(`goals.status${capitalize(goal.status)}`)}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-[var(--text-secondary)] hover:text-[var(--status-error)]"
          title={t("goals.delete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded: key results */}
      {expanded && <KeyResultList goal={goal} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key result list                                                     */
/* ------------------------------------------------------------------ */

function KeyResultList({ goal }: { goal: Goal }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);

  const krs = goal.keyResults ?? [];

  return (
    <div className="border-t border-[var(--border)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {t("goals.keyResults")}
        </span>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--surface-hover)]"
        >
          <Plus className="h-3 w-3" />
          {t("goals.addKeyResult")}
        </button>
      </div>

      {krs.length === 0 && !showAdd ? (
        <p className="py-2 text-xs text-[var(--text-secondary)]">
          {t("goals.noKeyResults")}
        </p>
      ) : (
        <div className="space-y-2">
          {krs.map((kr) => (
            <KeyResultRow key={kr.id} goalId={goal.id} kr={kr} />
          ))}
        </div>
      )}

      {showAdd && (
        <KeyResultAddForm
          goalId={goal.id}
          onDone={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key result row (with inline current-value edit for manual KRs)      */
/* ------------------------------------------------------------------ */

function KeyResultRow({ goalId, kr }: { goalId: string; kr: KeyResult }) {
  const { t } = useTranslation();
  const updateKr = useUpdateKeyResult();
  const deleteKr = useDeleteKeyResult();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(kr.currentValue));

  const isManual = kr.kpiType === "manual";
  const isTask = kr.kpiType === "task_completion";

  function handleSave() {
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v >= 0) {
      updateKr.mutate({ goalId, krId: kr.id, body: { currentValue: v } });
    }
    setEditing(false);
  }

  function handleDelete() {
    if (window.confirm(t("goals.deleteKrConfirm"))) {
      deleteKr.mutate({ goalId, krId: kr.id });
    }
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{kr.title}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {t(`goals.kpi${capitalize(toCamel(kr.kpiType))}`)}
          </p>
        </div>

        {/* Value display / edit */}
        {isManual && editing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <span className="text-xs text-[var(--text-secondary)]">
              / {formatValue(kr.targetValue)} {kr.unit}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(kr.currentValue));
              setEditing(isManual);
            }}
            disabled={!isManual}
            className={cn(
              "shrink-0 text-sm tabular-nums",
              isManual
                ? "text-[var(--text)] hover:underline"
                : "cursor-default text-[var(--text-secondary)]",
            )}
            title={isTask ? t("goals.kpiTaskCompletion") : undefined}
          >
            {formatValue(kr.currentValue)} / {formatValue(kr.targetValue)}{" "}
            {kr.unit}
          </button>
        )}

        <span className="w-10 text-right text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
          {Math.round(kr.progress)}%
        </span>

        <button
          type="button"
          onClick={handleDelete}
          className="text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-[var(--status-error)] group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mini progress bar */}
      <div className="mt-1.5">
        <ProgressBar value={kr.progress} thin />
      </div>

      {kr.kpiType === "finance" && (
        <p className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("goals.financeHint")}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Key result add form                                                 */
/* ------------------------------------------------------------------ */

function KeyResultAddForm({
  goalId,
  onDone,
}: {
  goalId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const createKr = useCreateKeyResult();
  const [title, setTitle] = useState("");
  const [kpiType, setKpiType] = useState<KpiType>("manual");
  const [target, setTarget] = useState("100");
  const [unit, setUnit] = useState("%");

  function handleAdd() {
    const targetVal = parseFloat(target);
    if (!title.trim() || !Number.isFinite(targetVal) || targetVal <= 0) return;
    const body: CreateKeyResultInput = {
      title: title.trim(),
      kpiType,
      targetValue: targetVal,
      unit: unit.trim() || "%",
    };
    createKr.mutate(
      { goalId, body },
      {
        onSuccess: () => {
          setTitle("");
          setTarget("100");
          setUnit("%");
          onDone();
        },
      },
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("goals.titleField")}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("goals.titlePlaceholder")}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("goals.kpiType")}
        <select
          value={kpiType}
          onChange={(e) => setKpiType(e.target.value as KpiType)}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
        >
          {KPI_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`goals.kpi${capitalize(toCamel(k))}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("goals.targetValue")}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm tabular-nums"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        {t("goals.unit")}
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="w-16 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={handleAdd}
        disabled={createKr.isPending || !title.trim()}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
      >
        {createKr.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          t("goals.addKeyResult")
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Goal create modal                                                   */
/* ------------------------------------------------------------------ */

export function GoalCreateModal({
  defaultType,
  defaultPeriod,
  onClose,
}: {
  defaultType: GoalType;
  defaultPeriod: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createGoal = useCreateGoal();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GoalType>(defaultType);
  const [period, setPeriod] = useState(defaultPeriod);
  const [error, setError] = useState(false);

  function handleCreate() {
    if (!title.trim()) return;
    const body: CreateGoalInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      period: period.trim(),
      status: "active",
    };
    createGoal.mutate(body, {
      onSuccess: () => onClose(),
      onError: () => setError(true),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-sm font-semibold">{t("goals.newGoal")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form body */}
        <div className="space-y-3 px-5 py-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.titleField")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("goals.titlePlaceholder")}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.descriptionField")}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("goals.descriptionPlaceholder")}
              rows={2}
              className="resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {t("goals.periodType")}
              <select
                value={type}
                onChange={(e) => setType(e.target.value as GoalType)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm outline-none"
              >
                {GOAL_TYPES.map((gt) => (
                  <option key={gt} value={gt}>
                    {t(`goals.${gt}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {t("goals.period")}
              <input
                type="text"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder={t("goals.periodPlaceholder")}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>

          {error && (
            <p className="text-sm text-[var(--status-error)]">
              {t("goals.createError")}
            </p>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
          >
            {t("goals.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createGoal.isPending || !title.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {createGoal.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("goals.save")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared UI bits                                                      */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: GoalStatus }) {
  const { t } = useTranslation();
  const tone =
    status === "active"
      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
      : status === "completed"
        ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
        : "bg-[var(--surface-hover)] text-[var(--text-secondary)]";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
        tone,
      )}
    >
      {t(`goals.status${capitalize(status)}`)}
    </span>
  );
}

function ProgressBar({ value, thin }: { value: number; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 100
      ? "var(--status-success)"
      : pct >= 70
        ? "var(--accent)"
        : pct >= 40
          ? "var(--status-warning, #f59e0b)"
          : "var(--status-error)";
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-[var(--surface-hover)]",
        thin ? "h-1" : "h-2",
      )}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Capitalize the first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Convert snake_case to camelCase (e.g. "task_completion" → "TaskCompletion"). */
function toCamel(s: string): string {
  return s
    .split("_")
    .map((part) => capitalize(part))
    .join("");
}

/** Format a numeric value for display (compact for large numbers). */
function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  }
  // Show integers without decimals, otherwise up to 2 decimal places.
  return Number.isInteger(v)
    ? v.toLocaleString("en")
    : v.toLocaleString("en", { maximumFractionDigits: 2 });
}
