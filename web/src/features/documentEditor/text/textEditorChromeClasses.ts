import { cn } from "@/lib/utils";

export function toolbarIconButtonClass() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";
}

export function toolbarTextButtonClass(active: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
    active && "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]",
  );
}

export function modeButtonClass(active: boolean) {
  return cn(
    "rounded-md border px-2 py-1 text-xs",
    active
      ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
      : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
  );
}
