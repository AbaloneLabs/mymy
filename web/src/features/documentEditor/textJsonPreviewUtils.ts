import { cn } from "@/lib/utils";

export function jsonPreviewTypeClass(type: string) {
  return cn(
    "inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
    type === "object" && "border-[var(--accent)]/30 text-[var(--accent)]",
    type === "array" && "border-[var(--status-warning)]/30 text-[var(--status-warning)]",
    type === "string" && "border-[var(--status-success)]/30 text-[var(--status-success)]",
    type === "number" && "border-[var(--accent)]/30 text-[var(--accent)]",
    type === "boolean" && "border-[var(--status-warning)]/30 text-[var(--status-warning)]",
    type === "null" && "border-[var(--border)] text-[var(--text-faint)]",
  );
}
