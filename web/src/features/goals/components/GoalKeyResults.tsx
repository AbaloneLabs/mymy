import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateKeyResult,
  useDeleteKeyResult,
  useUpdateKeyResult,
} from "@/features/goals/api";
import { KPI_TYPES } from "@/features/goals/constants";
import { cn } from "@/lib/utils";
import type {
  CreateKeyResultInput,
  Goal,
  KeyResult,
  KpiType,
} from "@/types/goals";
import { ProgressBar } from "./GoalProgressBar";
import { capitalize, formatValue, toCamel } from "./goalViewFormat";

export function KeyResultList({ goal }: { goal: Goal }) {
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
