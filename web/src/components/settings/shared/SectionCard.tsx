import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: string;

  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}


export function SectionCard({ title, description, headerAction, children, className }: SectionCardProps) {
  return (
    <section className={cn("rounded-xl border border-[var(--border)] bg-[var(--surface)]", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
          )}
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </header>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}
