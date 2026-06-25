import {
  addDays,
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";

export type PeriodFilter = "7d" | "month" | "quarter" | "year" | "all";

export const PERIODS: { id: PeriodFilter; labelKey: string }[] = [
  { id: "7d", labelKey: "finance.period.7d" },
  { id: "month", labelKey: "finance.period.month" },
  { id: "quarter", labelKey: "finance.period.quarter" },
  { id: "year", labelKey: "finance.period.year" },
  { id: "all", labelKey: "finance.period.all" },
];

/**
 * Compute the [from, to] window for a period filter.
 * `to` is exclusive (start of next day/month/year).
 */
export function computePeriod(period: PeriodFilter): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case "7d": {
      const start = subDays(now, 7);
      return { from: start.toISOString(), to: now.toISOString() };
    }
    case "month": {
      const start = startOfMonth(now);
      const end = addDays(endOfMonth(now), 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "quarter": {
      const start = startOfMonth(subMonths(now, 2));
      const end = addDays(endOfMonth(now), 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "year": {
      const start = startOfYear(now);
      const end = addDays(endOfYear(now), 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    case "all":
    default:
      return { from: undefined, to: undefined };
  }
}
