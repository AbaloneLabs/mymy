import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function AuditLogPagination({
  currentPage,
  totalPages,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        disabled={!canPrevious}
        onClick={onPrevious}
        className={cn(
          "rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors",
          !canPrevious
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        )}
      >
        {t("settings.audit.prev")}
      </button>
      <span className="text-xs text-[var(--text-faint)]">
        {t("settings.audit.page", { page: currentPage, total: totalPages })}
      </span>
      <button
        type="button"
        disabled={!canNext}
        onClick={onNext}
        className={cn(
          "rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors",
          !canNext
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        )}
      >
        {t("settings.audit.next")}
      </button>
    </div>
  );
}
