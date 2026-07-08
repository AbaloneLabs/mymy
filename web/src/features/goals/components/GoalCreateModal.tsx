import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateGoal } from "@/features/goals/api";
import { GOAL_TYPES } from "@/features/goals/constants";
import type {
  CreateGoalInput,
  GoalType,
} from "@/types/goals";

export function GoalCreateModal({
  defaultType,
  defaultPeriod,
  onClose,
}: {
  defaultType: GoalType;
  defaultPeriod: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createGoal = useCreateGoal();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GoalType>(defaultType);
  const [period, setPeriod] = useState(defaultPeriod);
  const [error, setError] = useState(false);

  function handleCreate() {
    if (!title.trim()) return;
    const body: CreateGoalInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      period: period.trim(),
      status: "active",
    };
    createGoal.mutate(body, {
      onSuccess: () => onClose(),
      onError: () => setError(true),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="text-sm font-semibold">{t("goals.newGoal")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.titleField")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("goals.titlePlaceholder")}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {t("goals.descriptionField")}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("goals.descriptionPlaceholder")}
              rows={2}
              className="resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {t("goals.periodType")}
              <select
                value={type}
                onChange={(e) => setType(e.target.value as GoalType)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm outline-none"
              >
                {GOAL_TYPES.map((gt) => (
                  <option key={gt} value={gt}>
                    {t(`goals.${gt}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {t("goals.period")}
              <input
                type="text"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder={t("goals.periodPlaceholder")}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>

          {error && (
            <p className="text-sm text-[var(--status-error)]">
              {t("goals.createError")}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
          >
            {t("goals.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createGoal.isPending || !title.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {createGoal.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("goals.save")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
