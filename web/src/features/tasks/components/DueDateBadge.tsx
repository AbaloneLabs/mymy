import { Calendar } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { cn } from "@/lib/utils";

export function DueDateBadge({
  dueDate,
  done,
}: {
  dueDate: string;
  done: boolean;
}) {
  const date = new Date(dueDate);
  const overdue = !done && isPast(date) && !isToday(date);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        overdue
          ? "text-[var(--status-error)]"
          : "text-[var(--text-faint)]",
      )}
    >
      <Calendar className="h-3 w-3" strokeWidth={1.5} />
      {format(date, "MMM d")}
    </span>
  );
}
