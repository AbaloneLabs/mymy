import type { TaskStatusDef } from "@/types/task-statuses";
import type { TaskPriority } from "@/types/tasks";

export const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low"];

export const STATUS_COLORS = [
  "gray",
  "blue",
  "green",
  "orange",
  "red",
  "purple",
] as const;

export type StatusColor = (typeof STATUS_COLORS)[number];

export function statusBgClass(color: string): string {
  switch (color) {
    case "blue":
      return "bg-[var(--accent)]";
    case "green":
      return "bg-[var(--status-active)]";
    case "orange":
      return "bg-orange-400";
    case "red":
      return "bg-[var(--status-error)]";
    case "purple":
      return "bg-purple-400";
    case "gray":
    default:
      return "bg-[var(--text-faint)]";
  }
}

export function statusTextClass(color: string): string {
  switch (color) {
    case "blue":
      return "text-[var(--accent)]";
    case "green":
      return "text-[var(--status-active)]";
    case "orange":
      return "text-orange-400";
    case "red":
      return "text-[var(--status-error)]";
    case "purple":
      return "text-purple-400";
    case "gray":
    default:
      return "text-[var(--text-muted)]";
  }
}

export function findStatusDef(
  statuses: TaskStatusDef[] | undefined,
  slug: string,
): TaskStatusDef | undefined {
  return statuses?.find((status) => status.slug === slug);
}
