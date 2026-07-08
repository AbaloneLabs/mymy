import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AddStatusDialog } from "@/features/tasks/components/AddStatusDialog";
import { DueDateBadge } from "@/features/tasks/components/DueDateBadge";
import { PriorityDot } from "@/features/tasks/components/PriorityDot";
import {
  PRIORITY_ORDER,
  findStatusDef,
  statusBgClass,
  statusTextClass,
} from "@/features/tasks/utils";
import type { TaskStatus, TaskStatusDef } from "@/types/task-statuses";
import type { Task, TaskPriority } from "@/types/tasks";
import { cn } from "@/lib/utils";

export type StatusFilter = "all" | TaskStatus;

export function ListView({
  tasks,
  statuses,
  statusFilter,
  setStatusFilter,
  onToggle,
  onDelete,
  onUpdate,
}: {
  tasks: Task[];
  statuses: TaskStatusDef[];
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
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
  const [showAddStatus, setShowAddStatus] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<TaskStatus>("");
  const [draftPriority, setDraftPriority] = useState<TaskPriority>("medium");
  const [draftDueDate, setDraftDueDate] = useState("");

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? tasks
        : tasks.filter((task) => task.status === statusFilter),
    [tasks, statusFilter],
  );

  function handleExpand(task: Task) {
    if (expandedId === task.id) {
      setExpandedId(null);
      return;
    }
    flushDraft();
    setExpandedId(task.id);
    setDraftTitle(task.title);
    setDraftDescription(task.description);
    setDraftStatus(task.status);
    setDraftPriority(task.priority);
    setDraftDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
  }

  function flushDraft() {
    if (!expandedId) return;
    onUpdate(expandedId, {
      title: draftTitle,
      description: draftDescription,
      status: draftStatus || undefined,
      priority: draftPriority,
      dueDate: draftDueDate || "",
    });
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mb-4 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            statusFilter === "all"
              ? "bg-[var(--surface-active)] text-[var(--text)]"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          )}
        >
          {t("tasks.all")}
        </button>
        {statuses.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => setStatusFilter(s.slug)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === s.slug
                ? "bg-[var(--surface-active)] text-[var(--text)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", statusBgClass(s.color))} />
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAddStatus(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          title={t("tasks.addStatus")}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-[var(--text-faint)]">
          {t("tasks.noTasks")}
        </div>
      ) : (
        <ul className="space-y-1">
          {filtered.map((task) => {
            const isExpanded = expandedId === task.id;
            const taskDef = findStatusDef(statuses, task.status);
            const isDone = taskDef?.isDone ?? task.status === "done";
            return (
              <li key={task.id}>
                <div
                  className={cn(
                    "rounded-lg border bg-[var(--surface)] transition-colors",
                    isExpanded
                      ? "border-[var(--border-strong)]"
                      : "border-[var(--border)]",
                  )}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onToggle(task)}
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
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

                    <PriorityDot priority={task.priority} />

                    <button
                      type="button"
                      onClick={() => handleExpand(task)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span
                        className={cn(
                          "block truncate text-sm",
                          isDone
                            ? "text-[var(--text-faint)] line-through"
                            : "text-[var(--text)]",
                        )}
                      >
                        {task.title}
                      </span>
                    </button>

                    {taskDef && (
                      <span
                        className={cn(
                          "hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex",
                          statusTextClass(taskDef.color),
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            statusBgClass(taskDef.color),
                          )}
                        />
                        {taskDef.label}
                      </span>
                    )}

                    {task.dueDate && (
                      <DueDateBadge dueDate={task.dueDate} done={isDone} />
                    )}

                    <button
                      type="button"
                      onClick={() => handleExpand(task)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
                      ) : (
                        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
                      <input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={flushDraft}
                        placeholder={t("tasks.newTask")}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <textarea
                        value={draftDescription}
                        onChange={(e) => setDraftDescription(e.target.value)}
                        onBlur={flushDraft}
                        placeholder={t("tasks.description")}
                        rows={3}
                        className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                          {t("tasks.status")}
                          <select
                            value={draftStatus}
                            onChange={(e) => {
                              setDraftStatus(e.target.value);
                            }}
                            onBlur={flushDraft}
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
                            value={draftPriority}
                            onChange={(e) => {
                              setDraftPriority(e.target.value as TaskPriority);
                            }}
                            onBlur={flushDraft}
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
                            value={draftDueDate}
                            onChange={(e) => setDraftDueDate(e.target.value)}
                            onBlur={flushDraft}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => onDelete(task.id)}
                          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                          {t("tasks.delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showAddStatus && (
        <AddStatusDialog onClose={() => setShowAddStatus(false)} />
      )}
    </div>
  );
}
