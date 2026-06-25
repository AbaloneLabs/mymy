import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateTaskStatus } from "@/features/task-statuses/api";
import { DueDateBadge } from "@/features/tasks/components/DueDateBadge";
import { PriorityDot } from "@/features/tasks/components/PriorityDot";
import {
  PRIORITY_ORDER,
  STATUS_COLORS,
  type StatusColor,
  findStatusDef,
  statusBgClass,
  statusTextClass,
} from "@/features/tasks/utils";
import type { TaskStatus, TaskStatusDef } from "@/types/task-statuses";
import type { Task, TaskPriority } from "@/types/tasks";
import { cn } from "@/lib/utils";

export type StatusFilter = "all" | TaskStatus;
// ===========================================================================
// View toggle button
// ===========================================================================

// ===========================================================================
// Add status dialog (shared by list & board)
// ===========================================================================

function AddStatusDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const createStatus = useCreateTaskStatus();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<StatusColor>("gray");
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const slug = slugify(trimmed) || `status_${Date.now()}`;
    setError(null);
    createStatus.mutate(
      { slug, label: trimmed, color, isDone },
      {
        onSuccess: () => {
          onCreated?.(slug);
          onClose();
        },
        onError: () => {
          setError(t("tasks.statusSlugExists"));
        },
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--text)]">
            {t("tasks.addStatus")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">
              {t("tasks.statusLabel")}
            </span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("tasks.statusLabelPlaceholder")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-xs text-[var(--text-muted)]">
              {t("tasks.statusColor")}
            </span>
            <div className="flex items-center gap-2">
              {STATUS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform",
                    statusBgClass(c),
                    color === c
                      ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface)]"
                      : "opacity-70 hover:opacity-100",
                  )}
                  title={c}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={isDone}
              onChange={(e) => setIsDone(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
            />
            {t("tasks.statusIsDone")}
          </label>
          {error && (
            <p className="text-xs text-[var(--status-error)]">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!label.trim() || createStatus.isPending}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {createStatus.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {t("tasks.addStatus")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===========================================================================
// List view (full-width)
// ===========================================================================

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
    // Flush current draft if switching from another expanded task.
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
      {/* Status filter chips (dynamic) + add-status button */}
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
                  {/* Row */}
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

                    {/* Status badge */}
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

                  {/* Expanded edit panel */}
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
                        {/* Status select */}
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
                        {/* Priority select */}
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
                        {/* Due date */}
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
                        {/* Delete */}
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

// ===========================================================================
// Board view (Kanban)
// ===========================================================================

export function BoardView({
  tasks,
  statuses,
  onToggle,
  onDelete,
  onUpdate,
  onAddCard,
}: {
  tasks: Task[];
  statuses: TaskStatusDef[];
  onToggle: (task: Task) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, body: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string;
  }) => void;
  onAddCard: (status: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAddStatus, setShowAddStatus] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Group tasks by status (dynamic).
  const columns = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const s of statuses) map[s.slug] = [];
    // Tasks with an unknown status go into a fallback bucket keyed by their
    // status slug (so they still render).
    for (const task of tasks) {
      if (!map[task.status]) map[task.status] = [];
      map[task.status].push(task);
    }
    return map;
  }, [tasks, statuses]);

  const activeTask = activeId
    ? tasks.find((task) => task.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    // Target status comes from the droppable column data, or from the
    // dragged-over card's status (same column reorder).
    const overData = over.data.current as { status?: TaskStatus } | undefined;
    const overTask = tasks.find((task) => task.id === over.id);
    const targetStatus: TaskStatus | undefined =
      overData?.status ?? overTask?.status;

    if (!targetStatus) return;

    const draggedTask = tasks.find((task) => task.id === String(active.id));
    if (!draggedTask || draggedTask.status === targetStatus) return;

    // Cross-column move → persist status change.
    onUpdate(draggedTask.id, { status: targetStatus });
  }

  return (
    <div className="flex-1 overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
          {statuses.map((col) => (
            <BoardColumn
              key={col.slug}
              status={col.slug}
              label={col.label}
              color={col.color}
              tasks={columns[col.slug] ?? []}
              onCardClick={(id) => setEditingId(id)}
              onAddCard={() => onAddCard(col.slug)}
            />
          ))}

          {/* Add-status column */}
          <button
            type="button"
            onClick={() => setShowAddStatus(true)}
            className="flex h-full w-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            title={t("tasks.addStatus")}
          >
            <Plus className="h-5 w-5" strokeWidth={1.75} />
            <span className="text-xs font-medium">{t("tasks.addStatus")}</span>
          </button>
        </div>

        <DragOverlay>
          {activeTask ? (
            <KanbanCard task={activeTask} statuses={statuses} dragOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Edit modal */}
      {editingId && (
        <TaskEditModal
          task={tasks.find((task) => task.id === editingId)!}
          statuses={statuses}
          onClose={() => setEditingId(null)}
          onToggle={onToggle}
          onDelete={(id) => {
            onDelete(id);
            setEditingId(null);
          }}
          onUpdate={onUpdate}
        />
      )}

      {showAddStatus && (
        <AddStatusDialog onClose={() => setShowAddStatus(false)} />
      )}
    </div>
  );
}

function BoardColumn({
  status,
  label,
  color,
  tasks,
  onCardClick,
  onAddCard,
}: {
  status: TaskStatus;
  label: string;
  color: string;
  tasks: Task[];
  onCardClick: (id: string) => void;
  onAddCard: () => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[280px] shrink-0 flex-col rounded-xl border bg-[var(--surface-hover)] transition-colors",
        isOver
          ? "border-[var(--accent)] bg-[var(--surface-active)]"
          : "border-[var(--border)]",
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn("h-2 w-2 rounded-full", statusBgClass(color))}
          />
          <span className="text-sm font-semibold text-[var(--text)]">
            {label}
          </span>
          <span className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          {tasks.length === 0 ? (
            <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-faint)]">
              {""}
            </div>
          ) : (
            tasks.map((task) => (
              <SortableKanbanCard
                key={task.id}
                task={task}
                onClick={() => onCardClick(task.id)}
              />
            ))
          )}
        </div>
      </SortableContext>

      {/* Add card */}
      <button
        type="button"
        onClick={onAddCard}
        className="m-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("tasks.addCard")}
      </button>
    </div>
  );
}

/** Sortable wrapper that renders a KanbanCard. */
function SortableKanbanCard({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "touch-none select-none",
        isDragging && "opacity-40",
      )}
    >
      <KanbanCard task={task} />
    </div>
  );
}

/** Static card render. Used by both SortableKanbanCard and DragOverlay. */
function KanbanCard({
  task,
  statuses,
  dragOverlay,
}: {
  task: Task;
  statuses?: TaskStatusDef[];
  dragOverlay?: boolean;
}) {
  const taskDef = statuses ? findStatusDef(statuses, task.status) : undefined;
  const isDone = taskDef?.isDone ?? task.status === "done";
  return (
    <div
      className={cn(
        "cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm transition-shadow",
        dragOverlay && "rotate-2 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityDot priority={task.priority} />
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug",
            isDone
              ? "text-[var(--text-faint)] line-through"
              : "text-[var(--text)]",
          )}
        >
          {task.title}
        </span>
      </div>
      {task.description && (
        <p
          className={cn(
            "mt-1 pl-4 text-xs leading-snug",
            "line-clamp-2 text-[var(--text-faint)]",
          )}
        >
          {task.description}
        </p>
      )}
      {task.dueDate && (
        <div className="mt-1.5 pl-4">
          <DueDateBadge dueDate={task.dueDate} done={isDone} />
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Edit modal (board only)
// ===========================================================================

function TaskEditModal({
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
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(
    task.dueDate ? task.dueDate.slice(0, 10) : "",
  );

  const taskDef = findStatusDef(statuses, task.status);
  const isDone = taskDef?.isDone ?? task.status === "done";

  // Flush on unmount.
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
        {/* Modal header */}
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

        {/* Modal body */}
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
            {/* Status select */}
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
        </div>

        {/* Modal footer */}
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

// ===========================================================================
// Shared primitives
// ===========================================================================
