import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GoalType } from "@/types/goals";

/**
 * Goals view-mode store.
 *
 * Persists the user's preferred period filter (type + year + quarter) to
 * localStorage so it survives page refreshes. Matches the tasksView pattern.
 *
 * The `period` label is derived from type/year/quarter and sent to the API
 * as a single string (e.g. "2026-Q3", "2026", "2026-06").
 */
interface GoalsViewState {
  /** Period type filter */
  type: GoalType;
  /** Year (e.g. 2026) */
  year: number;
  /** Quarter 1-4 (only used when type === "quarterly") */
  quarter: number;
  /** Month 1-12 (only used when type === "monthly") */
  month: number;
  setType: (type: GoalType) => void;
  setYear: (year: number) => void;
  setQuarter: (quarter: number) => void;
  setMonth: (month: number) => void;
}

const now = new Date();

export const useGoalsViewStore = create<GoalsViewState>()(
  persist(
    (set) => ({
      type: "quarterly",
      year: now.getFullYear(),
      quarter: Math.floor(now.getMonth() / 3) + 1,
      month: now.getMonth() + 1,
      setType: (type) => set({ type }),
      setYear: (year) => set({ year }),
      setQuarter: (quarter) => set({ quarter }),
      setMonth: (month) => set({ month }),
    }),
    { name: "mymy-goals-view" },
  ),
);

/**
 * Build the period label string from the store state.
 * - quarterly → "YYYY-Q#"
 * - annual    → "YYYY"
 * - monthly   → "YYYY-MM"
 */
export function buildPeriodLabel(
  type: GoalType,
  year: number,
  quarter: number,
  month: number,
): string {
  switch (type) {
    case "quarterly":
      return `${year}-Q${quarter}`;
    case "annual":
      return `${year}`;
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
  }
}
