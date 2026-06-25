import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {

  label: string;

  description?: string;

  children: ReactNode;
  className?: string;
}


export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2", className)}>
      <div className="min-w-0">
        <div className="text-sm text-[var(--text)]">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
