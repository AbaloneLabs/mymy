import { cn } from "@/lib/utils";

export function ShortcutTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--surface-active)] font-medium text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      {label}
    </button>
  );
}
