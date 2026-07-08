import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDeleteGoal,
  useUpdateGoal,
} from "@/features/goals/api";
import type {
  Goal,
  GoalStatus,
} from "@/types/goals";
import { ProgressBar } from "./GoalProgressBar";
import { StatusBadge } from "./GoalStatusBadge";
import { KeyResultList } from "./GoalKeyResults";
import { capitalize } from "./goalViewFormat";

export function GoalCard({ goal }: { goal: Goal }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  function handleDelete() {
    if (window.confirm(t("goals.deleteConfirm"))) {
      deleteGoal.mutate(goal.id);
    }
  }

  function handleStatusToggle() {
    const next: GoalStatus =
      goal.status === "active"
        ? "completed"
        : goal.status === "completed"
          ? "archived"
          : "active";
    updateGoal.mutate({ id: goal.id, body: { status: next } });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[var(--text-secondary)] hover:text-[var(--text)]"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{goal.title}</h3>
            <StatusBadge status={goal.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span>{t(`goals.${goal.type}`)}</span>
            <span>·</span>
            <span>{goal.period}</span>
            {goal.description && (
              <>
                <span>·</span>
                <span className="truncate">{goal.description}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden w-32 sm:block">
            <ProgressBar value={goal.progress} />
          </div>
          <span className="w-10 text-right text-sm font-semibold tabular-nums">
            {Math.round(goal.progress)}%
          </span>
        </div>

        <button
          type="button"
          onClick={handleStatusToggle}
          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          title={t("goals.status")}
        >
          {t(`goals.status${capitalize(goal.status)}`)}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-[var(--text-secondary)] hover:text-[var(--status-error)]"
          title={t("goals.delete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {expanded && <KeyResultList goal={goal} />}
    </div>
  );
}
