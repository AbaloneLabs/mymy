import { cn } from "@/lib/utils";
import type { TaskStatusColor } from "@/types/task-statuses";

const STATUS_COLORS: { value: TaskStatusColor; className: string }[] = [
  { value: "gray", className: "bg-[var(--text-faint)]" },
  { value: "blue", className: "bg-[var(--accent)]" },
  { value: "green", className: "bg-[var(--status-success)]" },
  { value: "orange", className: "bg-[var(--status-warning)]" },
  { value: "red", className: "bg-[var(--status-error)]" },
  { value: "purple", className: "bg-[var(--accent-hover)]" },
];

export function TaskStatusColorPicker({
  value,
  onChange,
}: {
  value: TaskStatusColor;
  onChange: (color: TaskStatusColor) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {STATUS_COLORS.map((color) => (
        <button
          key={color.value}
          onClick={() => onChange(color.value)}
          className={cn(
            "h-4 w-4 rounded-full",
            color.className,
            value === color.value &&
              "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--surface)]",
          )}
          aria-label={color.value}
        />
      ))}
    </div>
  );
}

export function TaskStatusColorDot({ color }: { color: TaskStatusColor }) {
  return (
    <span
      className={cn(
        "h-3 w-3 shrink-0 rounded-full",
        STATUS_COLORS.find((entry) => entry.value === color)?.className ??
          "bg-[var(--text-faint)]",
      )}
    />
  );
}
