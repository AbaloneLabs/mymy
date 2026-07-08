import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AddStatusDialog } from "@/features/tasks/components/AddStatusDialog";
import { DueDateBadge } from "@/features/tasks/components/DueDateBadge";
import { PriorityDot } from "@/features/tasks/components/PriorityDot";
import { TaskEditModal } from "@/features/tasks/components/TaskEditModal";
import {
  findStatusDef,
  statusBgClass,
} from "@/features/tasks/utils";
import type { TaskStatus, TaskStatusDef } from "@/types/task-statuses";
import type { Task, TaskPriority } from "@/types/tasks";
import { cn } from "@/lib/utils";

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

  const columns = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const s of statuses) map[s.slug] = [];
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

    const overData = over.data.current as { status?: TaskStatus } | undefined;
    const overTask = tasks.find((task) => task.id === over.id);
    const targetStatus: TaskStatus | undefined =
      overData?.status ?? overTask?.status;

    if (!targetStatus) return;

    const draggedTask = tasks.find((task) => task.id === String(active.id));
    if (!draggedTask || draggedTask.status === targetStatus) return;

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
