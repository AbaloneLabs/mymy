import { cn } from "@/lib/utils";

export function ProgressBar({ value, thin }: { value: number; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 100
      ? "var(--status-success)"
      : pct >= 70
        ? "var(--accent)"
        : pct >= 40
          ? "var(--status-warning, #f59e0b)"
          : "var(--status-error)";
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-[var(--surface-hover)]",
        thin ? "h-1" : "h-2",
      )}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}
