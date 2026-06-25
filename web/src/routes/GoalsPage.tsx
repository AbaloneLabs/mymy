import { useState } from "react";
import { Loader2, Plus, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useGoals } from "@/features/goals/api";
import { GoalCard, GoalCreateModal } from "@/features/goals/components/GoalsViews";
import { GOAL_TYPES } from "@/features/goals/constants";
import { useGoalsViewStore, buildPeriodLabel } from "@/store/goalsView";
import { cn } from "@/lib/utils";

/**
 * Goals page — OKR tracking workspace.
 *
 * Layout (full-width, matches FinancePage/TasksPage):
 *   - Header: title + period selector (type/year/quarter/month) + new-goal button
 *   - Goal cards: each card shows title, period, overall progress bar,
 *     and a list of key results with per-KR progress.
 *   - Key results: manual KRs have an editable current value (slider/input);
 *     task_completion KRs show a read-only ratio; finance KRs show a hint.
 *
 * Progress is computed by the backend (average of KR progress). Empty periods
 * show an empty state.
 */
export default function GoalsPage() {
  const { t } = useTranslation();
  const { type, year, quarter, month, setType, setYear, setQuarter, setMonth } =
    useGoalsViewStore();

  const period = buildPeriodLabel(type, year, quarter, month);

  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useGoals(type, undefined, period);
  const goals = data?.goals ?? [];

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <Target
              className="h-5 w-5 text-[var(--text-secondary)]"
              strokeWidth={1.5}
            />
            <h1 className="text-lg font-semibold">{t("goals.title")}</h1>
          </div>

          {/* Period selector */}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
              {GOAL_TYPES.map((gt) => (
                <button
                  key={gt}
                  type="button"
                  onClick={() => setType(gt)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                    type === gt
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                >
                  {t(`goals.${gt}`)}
                </button>
              ))}
            </div>

            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm outline-none"
            >
              {[-1, 0, 1].map((delta) => {
                const y = new Date().getFullYear() + delta;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </select>

            {type === "quarterly" &&
              [1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuarter(q)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    quarter === q
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                >
                  Q{q}
                </button>
              ))}

            {type === "monthly" && (
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm outline-none"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* New goal button */}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Plus className="h-4 w-4" />
            {t("goals.newGoal")}
          </button>
        </header>

        {/* Goal cards */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
              <Target className="mb-3 h-10 w-10 opacity-40" strokeWidth={1} />
              <p className="text-sm">{t("goals.empty")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create goal modal */}
      {showCreate && (
        <GoalCreateModal
          defaultType={type}
          defaultPeriod={period}
          onClose={() => setShowCreate(false)}
        />
      )}
    </AppLayout>
  );
}
