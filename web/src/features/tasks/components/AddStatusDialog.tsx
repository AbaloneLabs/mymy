import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateTaskStatus } from "@/features/task-statuses/api";
import {
  STATUS_COLORS,
  statusBgClass,
  type StatusColor,
} from "@/features/tasks/utils";
import { cn } from "@/lib/utils";

export function AddStatusDialog({
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
