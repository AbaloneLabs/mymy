import type { TaskPriority } from "@/types/tasks";
import { cn } from "@/lib/utils";

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  const color: Record<TaskPriority, string> = {
    urgent: "bg-[var(--status-error)]",
    high: "bg-orange-400",
    medium: "bg-[var(--accent)]",
    low: "bg-[var(--text-faint)]",
  };

  return (
    <span
      className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", color[priority])}
      title={priority}
    />
  );
}
