import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useTaskStatuses } from "@/features/task-statuses/api";
import type { TaskStatusDef } from "@/types/task-statuses";

export function TaskStatusDeleteDialog({
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
  const reassignOptions = allStatuses.filter((s) => s.slug !== status.slug);
  const [reassignTo, setReassignTo] = useState<string>(
    reassignOptions[0]?.slug ?? "",
  );

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
              {reassignOptions.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.label}
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
