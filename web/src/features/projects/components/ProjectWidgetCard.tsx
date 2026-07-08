import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ProjectWidgetCard({
  title,
  onViewAll,
  children,
}: {
  title: string;
  onViewAll?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            {t("projectDetail.viewAll")}
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function ProjectActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
    >
      <Icon className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
      <span>{label}</span>
      <ArrowRight
        className="ml-auto h-3.5 w-3.5 text-[var(--text-faint)]"
        strokeWidth={1.5}
      />
    </button>
  );
}
