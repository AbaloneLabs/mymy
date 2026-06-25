import { useMemo } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/calendar";

interface CalendarGridProps {
  /** First moment of the currently viewed month. */
  cursor: Date;
  /** Move the cursor. */
  onCursorChange: (date: Date) => void;
  /** The selected day (or null). */
  selectedDate: Date | null;
  /** Select a day. */
  onSelectDate: (date: Date) => void;
  /** Events to render (already filtered by project/agent by parent). */
  events: CalendarEvent[];
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Month-grid calendar (Linear-style).
 * Renders a 6×7 grid for the month containing `cursor`.
 * Clicking a day calls onSelectDate.
 */
export function CalendarGrid({
  cursor,
  onCursorChange,
  selectedDate,
  onSelectDate,
  events,
}: CalendarGridProps) {
  const { t } = useTranslation();

  const days = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  // Map: yyyy-MM-dd -> event count, for quick badge rendering.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = format(new Date(ev.startDate), "yyyy-MM-dd");
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const weekdayLabels = useMemo(
    () =>
      WEEKDAYS.map((d) => {
        const ref = addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), d);
        return format(ref, "EEEEEE"); // short: Mo, Tu, ...
      }),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Month header + nav */}
      <div className="flex items-center justify-between px-1 pb-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          {format(cursor, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCursorChange(addMonths(cursor, -1))}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label={t("calendar.prevMonth")}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(new Date())}
            className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(addMonths(cursor, 1))}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label={t("calendar.nextMonth")}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Weekday header row */}
      <div className="grid grid-cols-7 border-b border-[var(--border)] pb-1">
        {weekdayLabels.map((wd, i) => (
          <div
            key={i}
            className="px-1 text-center text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden pt-1">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const isSel = selectedDate ? isSameDay(day, selectedDate) : false;
          const todays = isToday(day);
          const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDate(day)}
              className={cn(
                "relative flex min-h-[56px] flex-col items-start gap-1 rounded-md border p-1.5 text-left transition-colors duration-150",
                "border-transparent",
                isSel
                  ? "border-[var(--accent)] bg-[var(--surface-hover)]"
                  : "hover:bg-[var(--surface-hover)]",
                inMonth ? "text-[var(--text)]" : "text-[var(--text-faint)]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  todays
                    ? "bg-[var(--accent)] font-semibold text-white"
                    : "font-medium",
                )}
              >
                {format(day, "d")}
              </span>

              {/* Event dots/badges */}
              <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 2).map((ev) => (
                  <span
                    key={ev.id}
                    className="truncate rounded bg-[var(--accent-from)]/20 px-1 py-px text-[9px] leading-tight text-[var(--accent)]"
                  >
                    {ev.title}
                  </span>
                ))}
                {dayEvents.length > 2 && (
                  <span className="px-1 text-[9px] text-[var(--text-faint)]">
                    +{dayEvents.length - 2}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
