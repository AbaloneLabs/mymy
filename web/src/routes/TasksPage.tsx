import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List as ListIcon, Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useCreateAction } from "@/hooks/useGlobalShortcuts";
import { useProjectContext } from "@/store/projectContext";
import { useTasksViewStore } from "@/store/tasksView";
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from "@/features/tasks/api";
import { useTaskStatuses } from "@/features/task-statuses/api";
import {
  BoardView,
  ListView,
  type StatusFilter,
} from "@/features/tasks/components/TasksViews";
import { ViewToggleButton } from "@/features/tasks/components/ViewToggleButton";
import { findStatusDef } from "@/features/tasks/utils";
import type { TaskStatus } from "@/types/task-statuses";
import type { Task } from "@/types/tasks";

/**
 * Tasks page — full-width workspace with a view toggle between
 * List and Kanban (board) modes.
 *
 * Statuses are dynamic (task_statuses table). Users can add custom
 * statuses via the "+" button in both list filter chips and the board
 * column list. Status order, color, and isDone flag are managed in
 * Settings > Tasks.
 *
 * - List: single-column list with dynamic status filter chips +
 *   inline expand-to-edit panel (including a status selector).
 * - Board: one column per status. Cards are draggable across columns
 *   to change status. Card click opens an edit modal (with status
 *   selector). A trailing "+" column lets users add new statuses.
 *
 * Filters by the TopBar project context. Sorting is handled by the
 * backend (open first, urgent first, soonest due first). Same-column
 * reorder in the board is visual-only — the backend sorts by
 * priority/due_date, so manual ordering resets on refetch.
 */

export default function TasksPage() {
  const { t } = useTranslation();
  const { selectedProjectId } = useProjectContext();
  const view = useTasksViewStore((s) => s.view);
  const setView = useTasksViewStore((s) => s.setView);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [newTitle, setNewTitle] = useState("");
  const [newStatus, setNewStatus] = useState<TaskStatus>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const newTaskInputRef = useRef<HTMLInputElement>(null);

  // Fetch ALL tasks (no status filter) so the board can group by status.
  // The list view filters client-side via statusFilter.
  const { data, isLoading } = useTasks(selectedProjectId ?? undefined);
  const allTasks = data?.tasks ?? [];

  // Dynamic status definitions.
  const { data: statusesData } = useTaskStatuses();
  const statuses = useMemo(
    () => statusesData?.statuses ?? [],
    [statusesData?.statuses],
  );
  // Default new-task status: first non-done status, or first status.
  const defaultNewStatus = useMemo(() => {
    const firstOpen = statuses.find((s) => !s.isDone);
    return (firstOpen ?? statuses[0])?.slug ?? "";
  }, [statuses]);
  // Effective status used when creating a task. Falls back to the default
  // (first open status) when the user has not explicitly picked one.
  const effectiveNewStatus = newStatus || defaultNewStatus;

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // --- Create -----------------------------------------------------------

  function handleCreate(presetStatus?: TaskStatus) {
    const title = newTitle.trim();
    if (!title) return;
    setCreateError(false);
    setCreating(true);
    createTask.mutate(
      {
        title,
        projectId: selectedProjectId ?? undefined,
        status: presetStatus ?? (effectiveNewStatus || undefined),
      },
      {
        onSuccess: () => {
          setNewTitle("");
          setCreating(false);
        },
        onError: () => {
          setCreating(false);
          setCreateError(true);
        },
      },
    );
  }

  // --- Toggle complete --------------------------------------------------
  // Toggles between the first non-done status and the first done status.

  function handleToggle(task: Task) {
    const taskDef = findStatusDef(statuses, task.status);
    const isDone = taskDef?.isDone ?? task.status === "done";
    let next: TaskStatus;
    if (isDone) {
      // Move to first non-done status (or "todo" fallback).
      next = statuses.find((s) => !s.isDone)?.slug ?? "todo";
    } else {
      // Move to first done status (or "done" fallback).
      next = statuses.find((s) => s.isDone)?.slug ?? "done";
    }
    updateTask.mutate({ id: task.id, body: { status: next } });
  }

  // Keyboard shortcut: press T on the tasks page to focus the new-task input.
  const createNonce = useCreateAction("create.task");
  useEffect(() => {
    if (createNonce > 0) newTaskInputRef.current?.focus();
  }, [createNonce]);

  // --- Delete -----------------------------------------------------------

  function handleDelete(id: string) {
    if (window.confirm(t("tasks.deleteConfirm"))) {
      deleteTask.mutate(id);
    }
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Shared header */}
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">
            {t("tasks.tasks")}
          </h1>

          {/* New task composer (title + status selector) */}
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
            <Plus
              className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
              strokeWidth={1.5}
            />
            <input
              ref={newTaskInputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              placeholder={t("tasks.newTask")}
              disabled={creating}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none disabled:opacity-50"
            />
            {/* Status selector for new task */}
            <select
              value={effectiveNewStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              disabled={creating}
              className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              title={t("tasks.status")}
            >
              {statuses.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
            {creating && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
            )}
          </div>

          {createError && (
            <span className="text-xs text-[var(--status-error)]">
              {t("tasks.createError")}
            </span>
          )}

          {/* View toggle */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            <ViewToggleButton
              active={view === "list"}
              onClick={() => setView("list")}
              label={t("tasks.viewList")}
              icon={<ListIcon className="h-4 w-4" strokeWidth={1.75} />}
            />
            <ViewToggleButton
              active={view === "board"}
              onClick={() => setView("board")}
              label={t("tasks.viewBoard")}
              icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
        </header>

        {/* Body */}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2
              className="h-5 w-5 animate-spin text-[var(--text-muted)]"
              strokeWidth={1.75}
            />
            <span className="ml-2 text-sm text-[var(--text-muted)]">
              {t("common.loading")}
            </span>
          </div>
        ) : view === "list" ? (
          <ListView
            tasks={allTasks}
            statuses={statuses}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onUpdate={(id, body) => updateTask.mutate({ id, body })}
          />
        ) : (
          <BoardView
            tasks={allTasks}
            statuses={statuses}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onUpdate={(id, body) => updateTask.mutate({ id, body })}
            onAddCard={(status) => {
              const title = newTitle.trim();
              if (title) handleCreate(status);
            }}
          />
        )}
      </div>
    </AppLayout>
  );
}
