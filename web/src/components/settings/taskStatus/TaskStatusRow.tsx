import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Pencil, Trash2, X } from "lucide-react";
import {
  useDeleteTaskStatus,
  useUpdateTaskStatus,
} from "@/features/task-statuses/api";
import { cn } from "@/lib/utils";
import type { TaskStatusColor, TaskStatusDef } from "@/types/task-statuses";
import { TaskStatusDeleteDialog } from "./TaskStatusDeleteDialog";
import {
  TaskStatusColorDot,
  TaskStatusColorPicker,
} from "./TaskStatusPalette";

export function TaskStatusRow({ status }: { status: TaskStatusDef }) {
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
    if (!trimmed) {
      setEditing(false);
      setLabel(status.label);
      setColor(status.color);
      return;
    }
    if (trimmed === status.label && color === status.color) {
      setEditing(false);
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
          <TaskStatusColorPicker value={color} onChange={setColor} />
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
          <TaskStatusColorDot color={status.color} />
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
        <TaskStatusDeleteDialog
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
