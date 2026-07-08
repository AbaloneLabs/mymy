import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CronResult } from "@/types/agent-ops";

export function CronResultsPanel({ results }: { results: CronResult[] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 text-sm font-medium text-[var(--text)]">
        {t("agents.cron.lastResults")}
      </div>
      {results.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("agents.cron.noResults")}
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.id}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[var(--text)]">
                    {result.jobTitle}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                    {result.createdAt}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase",
                    result.status === "success"
                      ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                      : result.status === "silent"
                        ? "bg-[var(--surface-hover)] text-[var(--text-muted)]"
                        : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
                  )}
                >
                  {t(`agents.cron.status.${result.status}`)}
                </span>
              </div>
              {result.output && (
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 text-xs text-[var(--text-muted)]">
                  {result.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
