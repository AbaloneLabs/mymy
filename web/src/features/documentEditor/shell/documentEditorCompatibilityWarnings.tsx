import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { DocumentCompatibilityWarning } from "@/types/documentEditor";

export function CompatibilityWarnings({
  warnings,
}: {
  warnings: DocumentCompatibilityWarning[];
}) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-warning)]" strokeWidth={1.75} />
        {t("documentEditor.compatibilityWarnings", {
          defaultValue: "Compatibility warnings",
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {warnings.map((warning) => (
          <span
            key={warning.code}
            className={cn(
              "inline-flex max-w-full items-center rounded-md border px-2 py-1 text-[11px]",
              warning.severity === "danger"
                ? "border-[var(--status-error)]/40 bg-[var(--status-error)]/10 text-[var(--status-error)]"
                : warning.severity === "warning"
                  ? "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[var(--status-warning)]"
                  : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]",
            )}
            title={warning.code}
          >
            <span className="truncate">{warning.message}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
