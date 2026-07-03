import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-4 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
      {label}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
      : status === "failed"
        ? "bg-[var(--status-error)]/10 text-[var(--status-error)]"
        : "bg-[var(--surface-hover)] text-[var(--text-muted)]";
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      {status}
    </span>
  );
}
