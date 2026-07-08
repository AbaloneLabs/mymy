import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { TaskStatusColor } from "@/types/task-statuses";
import { TaskStatusColorPicker } from "./TaskStatusPalette";

export function TaskStatusAddForm({
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
        <TaskStatusColorPicker value={color} onChange={setColor} />
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
