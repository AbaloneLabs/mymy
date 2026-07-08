import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export function SpreadsheetIconButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40",
        active && "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
