import { useEffect, useState } from "react";
import { Activity, Check, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PRIORITY_ORDER, findStatusDef, statusBgClass } from "@/features/tasks/utils";
import { cn } from "@/lib/utils";
import type { TaskStatusDef } from "@/types/task-statuses";
import type { Task, TaskPriority } from "@/types/tasks";
import type { TaskStatus } from "@/types/task-statuses";
import { useTaskRuntime } from "@/features/tasks/api";

export function TaskEditModal({
  task,
  statuses,
  onClose,
  onToggle,
  onDelete,
  onUpdate,
}: {
  task: Task;
  statuses: TaskStatusDef[];
  onClose: () => void;
  onToggle: (task: Task) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, body: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const runtime = useTaskRuntime(task.id);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(
    task.dueDate ? task.dueDate.slice(0, 10) : "",
  );

  const taskDef = findStatusDef(statuses, task.status);
  const isDone = taskDef?.isDone ?? task.status === "done";

  useEffect(() => {
    return () => {
      onUpdate(task.id, {
        title,
        description,
        status,
        priority,
        dueDate: dueDate || "",
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(patch: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string;
  }>) {
    onUpdate(task.id, {
      title,
      description,
      status,
      priority,
      dueDate: dueDate || "",
      ...patch,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggle(task)}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                isDone
                  ? "border-[var(--status-active)] bg-[var(--status-active)]"
                  : "border-[var(--border-strong)] hover:border-[var(--accent)]",
              )}
              title={isDone ? t("tasks.done") : t("tasks.todo")}
            >
              {isDone && (
                <Check
                  className="h-3 w-3 text-[var(--surface)]"
                  strokeWidth={3}
                />
              )}
            </button>
            <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]">
              {taskDef && (
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    statusBgClass(taskDef.color),
                  )}
                />
              )}
              {taskDef?.label ?? task.status}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commit({ title })}
            placeholder={t("tasks.newTask")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => commit({ description })}
            placeholder={t("tasks.description")}
            rows={4}
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              {t("tasks.status")}
              <select
                value={status}
                onChange={(e) => {
                  const next = e.target.value as TaskStatus;
                  setStatus(next);
                  commit({ status: next });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              >
                {statuses.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              {t("tasks.priority")}
              <select
                value={priority}
                onChange={(e) => {
                  const next = e.target.value as TaskPriority;
                  setPriority(next);
                  commit({ priority: next });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {t(`tasks.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              {t("tasks.dueDate")}
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  commit({ dueDate: e.target.value || "" });
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] p-3">
            <div className="flex items-center justify-between text-xs font-medium text-[var(--text)]">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {t("tasks.relatedRuns")}
              </span>
              {(runtime.data?.activeRunCount ?? 0) > 0 && (
                <span className="text-[var(--status-warning)]">
                  {t("tasks.activeAgents", {
                    count: runtime.data?.activeRunCount ?? 0,
                  })}
                </span>
              )}
            </div>
            {runtime.isLoading ? (
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                {t("common.loading")}
              </p>
            ) : (runtime.data?.runs.length ?? 0) === 0 ? (
              <p className="mt-2 text-xs text-[var(--text-faint)]">
                {t("tasks.noRelatedRuns")}
              </p>
            ) : (
              <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                {runtime.data?.runs.map((run) => (
                  <div
                    key={`${run.runId}:${run.linkKind}:${run.operation ?? ""}`}
                    className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]"
                  >
                    <span className="truncate">
                      {run.agentProfile} · {run.triggerType} · {run.linkKind}
                    </span>
                    <span className="shrink-0">{run.outcome ?? run.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("tasks.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
