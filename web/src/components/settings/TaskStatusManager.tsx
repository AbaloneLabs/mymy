/**
 * Task status manager — Settings > Tasks tab.
 *
 * Lists all custom task statuses (categories) with drag-to-reorder support,
 * color picker, label editing, isDone toggle, and add/delete. System statuses
 * (todo/in_progress/done) cannot be deleted but can be edited/reordered.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, X, Check, Plus, Loader2 } from "lucide-react";
import { useTaskStatuses, useCreateTaskStatus, useUpdateTaskStatus, useDeleteTaskStatus, useReorderTaskStatuses } from "@/features/task-statuses/api";
import type { TaskStatusDef, TaskStatusColor } from "@/types/task-statuses";
import { cn } from "@/lib/utils";

/** Available color palette for statuses. */
const STATUS_COLORS: { value: TaskStatusColor; className: string }[] = [
  { value: "gray", className: "bg-[var(--text-faint)]" },
  { value: "blue", className: "bg-[var(--accent)]" },
  { value: "green", className: "bg-[var(--status-success)]" },
  { value: "orange", className: "bg-[var(--status-warning)]" },
  { value: "red", className: "bg-[var(--status-error)]" },
  { value: "purple", className: "bg-[var(--accent-hover)]" },
];

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
              <SortableStatusRow key={status.slug} status={status} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {showAddForm ? (
        <AddStatusForm
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

/** A single draggable status row with inline editing. */
function SortableStatusRow({ status }: { status: TaskStatusDef }) {
  const { t } = useTranslation();
  const updateStatus = useUpdateTaskStatus();
  const deleteStatus = useDeleteTaskStatus();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(status.label);
  const [color, setColor] = useState<TaskStatusColor>(status.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: status.slug });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function saveEdit() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === status.label) {
      setEditing(false);
      setLabel(status.label);
      return;
    }
    updateStatus.mutate(
      { slug: status.slug, body: { label: trimmed, color } },
      { onSuccess: () => setEditing(false) },
    );
  }

  function cancelEdit() {
    setEditing(false);
    setLabel(status.label);
    setColor(status.color);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--text-faint)] hover:text-[var(--text-muted)] active:cursor-grabbing"
        title={t("settings.tasks.dragHint")}
        aria-label={t("settings.tasks.dragHint")}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {editing ? (
        <div className="flex flex-1 items-center gap-3">
          {/* Color picker */}
          <div className="flex items-center gap-1">
            {STATUS_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                className={cn(
                  "h-4 w-4 rounded-full",
                  c.className,
                  color === c.value && "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--surface)]",
                )}
                aria-label={c.value}
              />
            ))}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={saveEdit}
            className="text-[var(--status-success)] hover:opacity-70"
            title={t("common.save")}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={cancelEdit}
            className="text-[var(--text-muted)] hover:opacity-70"
            title={t("common.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          {/* Color dot */}
          <span
            className={cn(
              "h-3 w-3 shrink-0 rounded-full",
              STATUS_COLORS.find((c) => c.value === status.color)?.className ??
                "bg-[var(--text-faint)]",
            )}
          />
          <span className="flex-1 text-sm font-medium text-[var(--text)]">
            {status.label}
          </span>
          <span className="text-xs text-[var(--text-faint)]">{status.slug}</span>
          {status.isDone && (
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {t("settings.tasks.doneLabel")}
            </span>
          )}
          {status.isSystem && (
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)]">
              {t("settings.tasks.systemLabel")}
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-[var(--text-muted)] hover:text-[var(--accent)]"
            title={t("common.edit")}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!status.isSystem && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[var(--text-muted)] hover:text-[var(--status-error)]"
              title={t("common.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </>
      )}

      {confirmDelete && (
        <DeleteStatusDialog
          status={status}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={(reassignTo) => {
            deleteStatus.mutate(
              { slug: status.slug, reassignTo },
              { onSuccess: () => setConfirmDelete(false) },
            );
          }}
          deleting={deleteStatus.isPending}
        />
      )}
    </li>
  );
}

/** Add new status form. */
function AddStatusForm({
  onCancel,
  onSubmit,
  submitting,
}: {
  onCancel: () => void;
  onSubmit: (label: string, color: TaskStatusColor) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TaskStatusColor>("gray");

  return (
    <div className="space-y-3 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {STATUS_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => setColor(c.value)}
              className={cn(
                "h-4 w-4 rounded-full",
                c.className,
                color === c.value && "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--surface)]",
              )}
              aria-label={c.value}
            />
          ))}
        </div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim()) onSubmit(label.trim(), color);
            if (e.key === "Escape") onCancel();
          }}
          placeholder={t("settings.tasks.labelPlaceholder")}
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={() => label.trim() && onSubmit(label.trim(), color)}
          disabled={!label.trim() || submitting}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          {t("common.add")}
        </button>
      </div>
    </div>
  );
}

/** Delete confirmation dialog with reassignment target selection. */
function DeleteStatusDialog({
  status,
  onCancel,
  onConfirm,
  deleting,
}: {
  status: TaskStatusDef;
  onCancel: () => void;
  onConfirm: (reassignTo?: string) => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useTaskStatuses();
  const allStatuses = data?.statuses ?? [];
  // Other statuses that tasks can be reassigned to.
  const reassignOptions = allStatuses.filter((s) => s.slug !== status.slug);
  const [reassignTo, setReassignTo] = useState<string>(reassignOptions[0]?.slug ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">
          {t("settings.tasks.deleteTitle")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          {t("settings.tasks.deleteConfirm", { label: status.label })}
        </p>
        {reassignOptions.length > 0 && (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              {t("settings.tasks.reassignTo")}
            </label>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2 py-1 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            >
              {reassignOptions.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onConfirm(reassignTo || undefined)}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-md bg-[var(--status-error)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
