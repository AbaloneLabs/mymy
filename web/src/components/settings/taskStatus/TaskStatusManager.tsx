/**
 * Task status manager for the Settings > Tasks tab.
 *
 * The top-level component owns list loading, drag ordering, and the create
 * mutation. Row editing and destructive confirmation live in separate modules
 * so the drag container stays focused on collection behavior.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Loader2, Plus } from "lucide-react";
import {
  useCreateTaskStatus,
  useReorderTaskStatuses,
  useTaskStatuses,
} from "@/features/task-statuses/api";
import { TaskStatusAddForm } from "./TaskStatusAddForm";
import { TaskStatusRow } from "./TaskStatusRow";

export function TaskStatusManager() {
  const { t } = useTranslation();
  const { data, isLoading } = useTaskStatuses();
  const statuses = data?.statuses ?? [];
  const reorder = useReorderTaskStatuses();
  const createStatus = useCreateTaskStatus();
  const [showAddForm, setShowAddForm] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = statuses.findIndex((s) => s.slug === active.id);
    const newIndex = statuses.findIndex((s) => s.slug === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(statuses, oldIndex, newIndex);
    reorder.mutate({ slugs: next.map((s) => s.slug) });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {t("settings.tasks.description")}
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={statuses.map((s) => s.slug)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {statuses.map((status) => (
              <TaskStatusRow key={status.slug} status={status} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {showAddForm ? (
        <TaskStatusAddForm
          onCancel={() => setShowAddForm(false)}
          onSubmit={(label, color) => {
            createStatus.mutate(
              { label, color },
              {
                onSuccess: () => setShowAddForm(false),
              },
            );
          }}
          submitting={createStatus.isPending}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus className="h-4 w-4" />
          {t("settings.tasks.add")}
        </button>
      )}
    </div>
  );
}
