import { useState } from "react";
import { Check, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateKeyResult,
  useDeleteKeyResult,
  useLinkTaskToKR,
  useUnlinkTaskFromKR,
  useUpdateKeyResult,
} from "@/features/goals/api";
import { KPI_TYPES } from "@/features/goals/constants";
import { useTaskStatuses } from "@/features/task-statuses/api";
import { useCreateTask, useTasks, useUpdateTask } from "@/features/tasks/api";
import { findStatusDef, statusBgClass } from "@/features/tasks/utils";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type {
  CreateKeyResultInput,
  Goal,
  KeyResult,
  KpiType,
  LinkedTask,
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
        <div className="mt-1 space-y-0.5 text-[10px] text-[var(--text-faint)]">
          {kr.financeDefinition ? (
            <p>
              {t("goals.financeDefinition", {
                metric: t(`goals.finance${capitalize(kr.financeDefinition.metric)}`),
                currency: kr.financeDefinition.currency,
                scope: t(`goals.financeScope${capitalize(kr.financeDefinition.scope)}`),
                status: t(`goals.financeStatus${capitalize(kr.financeDefinition.status)}`),
              })}
            </p>
          ) : null}
          <p className={kr.calculationStatus === "ready" ? "" : "text-[var(--status-warning)]"}>
            {t(`goals.calculationStatus.${kr.calculationStatus}`)}
          </p>
        </div>
      )}

      {/*
        KR-scoped task list for task_completion KRs.
        Shows linked tasks with toggle/unlink controls, a quick-create
        input, and a search panel for linking existing tasks.
      */}
      {isTask && (
        <KrTaskList
          goalId={goalId}
          krId={kr.id}
          linkedTasks={kr.linkedTasks ?? []}
        />
      )}
    </div>
  );
}

/**
 * Per-KR task management panel.
 *
 * Renders the list of tasks linked to a specific Key Result, lets the user
 * toggle a task's done state inline, unlink tasks, quick-create + link a
 * new task, and search/link an existing task from the workspace.
 *
 * The backend recalculates the KR's currentValue from these linked tasks,
 * so every link/unlink/toggle here indirectly updates the KR progress.
 */
function KrTaskList({
  goalId,
  krId,
  linkedTasks,
}: {
  goalId: string;
  krId: string;
  linkedTasks: LinkedTask[];
}) {
  const { t } = useTranslation();
  const linkTask = useLinkTaskToKR();
  const unlinkTask = useUnlinkTaskFromKR();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: tasksData } = useTasks(undefined, undefined, "all");
  const { data: statusesData } = useTaskStatuses();
  const statuses = statusesData?.statuses ?? [];

  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const linkedIds = new Set(linkedTasks.map((task) => task.id));

  // Unlinked tasks matching the search query, capped for dropdown readability.
  const availableTasks = (tasksData?.tasks ?? [])
    .filter((task) => !linkedIds.has(task.id))
    .filter(
      (task) =>
        query.trim() === "" ||
        task.title.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 10);

  function handleToggle(task: LinkedTask) {
    const def = findStatusDef(statuses, task.status);
    const isDone = def?.isDone ?? task.status === "done";
    const next = isDone
      ? (statuses.find((s) => !s.isDone)?.slug ?? "todo")
      : (statuses.find((s) => s.isDone)?.slug ?? "done");
    updateTask.mutate({ id: task.id, body: { status: next } });
  }

  function handleQuickCreate() {
    const title = newTaskTitle.trim();
    if (!title) return;
    createTask.mutate(
      { title },
      {
        onSuccess: (data) => {
          linkTask.mutate({ goalId, krId, taskId: data.task.id });
          setNewTaskTitle("");
        },
      },
    );
  }

  return (
    <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
      {linkedTasks.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          {t("goals.noLinkedTasks")}
        </p>
      ) : (
        linkedTasks.map((task) => {
          const def = findStatusDef(statuses, task.status);
          const isDone = def?.isDone ?? task.status === "done";
          return (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleToggle(task)}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  isDone
                    ? "border-[var(--status-success)] bg-[var(--status-success)] text-white"
                    : "border-[var(--border)] text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
              </button>
              <span
                className={cn(
                  "flex-1 truncate",
                  isDone && "text-[var(--text-secondary)] line-through",
                )}
              >
                {task.title}
              </span>
              {def && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] text-white",
                    statusBgClass(def.color),
                  )}
                >
                  {def.label}
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  unlinkTask.mutate({ goalId, krId, taskId: task.id })
                }
                className="text-[var(--text-secondary)] hover:text-[var(--status-error)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })
      )}

      {/* Quick create: type a title, press Enter, task is created + linked. */}
      <div className="flex items-center gap-1 pt-1">
        <input
          type="text"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickCreate();
          }}
          placeholder={t("goals.quickCreateTask")}
          className="flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={handleQuickCreate}
          disabled={!newTaskTitle.trim() || createTask.isPending}
          className="flex shrink-0 items-center rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {createTask.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Toggle search panel for linking existing workspace tasks. */}
      <button
        type="button"
        onClick={() => setShowSearch((v) => !v)}
        className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
      >
        <Search className="h-3 w-3" />
        {t("goals.linkExistingTask")}
      </button>
      {showSearch && (
        <div className="space-y-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("goals.searchTasks")}
            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
            autoFocus
          />
          {availableTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => {
                linkTask.mutate({ goalId, krId, taskId: task.id });
                setQuery("");
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)]"
            >
              <Plus className="h-3 w-3 shrink-0 text-[var(--accent)]" />
              <span className="flex-1 truncate">{task.title}</span>
            </button>
          ))}
          {availableTasks.length === 0 && (
            <p className="px-2 text-xs text-[var(--text-secondary)]">
              {t("goals.noTasksToLink")}
            </p>
          )}
        </div>
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
  const selectedProjectId = useProjectContext((state) => state.selectedProjectId);
  const [financeMetric, setFinanceMetric] = useState<"income" | "expense" | "net">("net");
  const [financeCurrency, setFinanceCurrency] = useState("KRW");
  const [financeScope, setFinanceScope] = useState<"all" | "general" | "project">(
    selectedProjectId ? "project" : "general",
  );
  const [financeStatus, setFinanceStatus] = useState<"all" | "cleared" | "pending">("cleared");
  const [financeFrom, setFinanceFrom] = useState("");
  const [financeTo, setFinanceTo] = useState("");
  const [financeCategory, setFinanceCategory] = useState("");

  function handleAdd() {
    const targetVal = parseFloat(target);
    if (!title.trim() || !Number.isFinite(targetVal) || targetVal <= 0) return;
    const body: CreateKeyResultInput = {
      title: title.trim(),
      kpiType,
      targetValue: targetVal,
      unit: kpiType === "finance" ? financeCurrency.trim().toUpperCase() : (unit.trim() || "%"),
      financeDefinition:
        kpiType === "finance"
          ? {
              metric: financeMetric,
              currency: financeCurrency.trim().toUpperCase(),
              scope: financeScope,
              projectId: financeScope === "project" ? (selectedProjectId ?? undefined) : undefined,
              status: financeStatus,
              from: financeFrom ? `${financeFrom}T00:00:00Z` : undefined,
              to: financeTo ? `${financeTo}T00:00:00Z` : undefined,
              category: financeCategory.trim() || undefined,
            }
          : undefined,
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
      {kpiType === "finance" && (
        <div className="basis-full grid gap-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeMetric")}
            <select value={financeMetric} onChange={(event) => setFinanceMetric(event.target.value as typeof financeMetric)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              <option value="income">{t("goals.financeIncome")}</option>
              <option value="expense">{t("goals.financeExpense")}</option>
              <option value="net">{t("goals.financeNet")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeCurrency")}
            <input value={financeCurrency} maxLength={3} onChange={(event) => setFinanceCurrency(event.target.value.toUpperCase())} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm uppercase" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeScope")}
            <select value={financeScope} onChange={(event) => setFinanceScope(event.target.value as typeof financeScope)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              <option value="general">{t("workspaceScope.general")}</option>
              <option value="all">{t("workspaceScope.all")}</option>
              {selectedProjectId && <option value="project">{t("goals.financeCurrentProject")}</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeStatus")}
            <select value={financeStatus} onChange={(event) => setFinanceStatus(event.target.value as typeof financeStatus)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              <option value="cleared">{t("goals.financeCleared")}</option>
              <option value="pending">{t("goals.financePending")}</option>
              <option value="all">{t("workspaceScope.all")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeFrom")}
            <input type="date" value={financeFrom} onChange={(event) => setFinanceFrom(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.financeTo")}
            <input type="date" value={financeTo} onChange={(event) => setFinanceTo(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] md:col-span-2">
            {t("goals.financeCategory")}
            <input value={financeCategory} onChange={(event) => setFinanceCategory(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
          </label>
          <p className="text-[10px] text-[var(--text-faint)] md:col-span-4">{t("goals.financeUnitHint")}</p>
        </div>
      )}
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
        disabled={
          createKr.isPending ||
          !title.trim() ||
          (kpiType === "finance" &&
            (financeCurrency.trim().length !== 3 ||
              (financeScope === "project" && !selectedProjectId) ||
              Boolean(financeFrom && financeTo && financeFrom >= financeTo)))
        }
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
