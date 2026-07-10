import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDeleteQuarantinedCronJob,
  useExportQuarantinedCronJob,
  useQuarantinedCronJobDetail,
  useQuarantinedCronJobs,
} from "@/features/agent-ops/api";
import type { QuarantinedCronJob } from "@/types/agent-ops";

export function CronSecurityQuarantinePanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuarantinedCronJobs();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--status-warning)]/30 bg-[var(--status-warning)]/5 p-3 text-xs text-[var(--text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        {t("agents.cron.quarantineLoading")}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 text-xs text-[var(--status-error)]">
        {t("agents.cron.quarantineLoadError")}
      </div>
    );
  }
  if (!data?.jobs.length) return null;

  return (
    <section className="rounded-lg border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-warning)]"
          strokeWidth={1.75}
        />
        <div>
          <h3 className="text-sm font-medium text-[var(--text)]">
            {t("agents.cron.quarantineTitle")}
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("agents.cron.quarantineDescription", {
              n: data.jobs.length,
            })}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {data.jobs.map((job) => (
          <QuarantinedJobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

function QuarantinedJobCard({ job }: { job: QuarantinedCronJob }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailQuery = useQuarantinedCronJobDetail(job.id, expanded);
  const exportMutation = useExportQuarantinedCronJob();
  const deleteMutation = useDeleteQuarantinedCronJob();
  const busy = exportMutation.isPending || deleteMutation.isPending;

  async function exportDefinition() {
    const detail = await exportMutation.mutateAsync(job.id);
    const blob = new Blob(
      [JSON.stringify(detail.originalDefinition, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `quarantined-cron-${safeFilename(job.legacyJobId)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function deleteDefinition() {
    if (window.confirm(t("agents.cron.quarantineConfirmDelete"))) {
      deleteMutation.mutate(job.id);
    }
  }

  return (
    <div className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-[var(--text)]">
              {job.title}
            </span>
            <span className="mt-0.5 block font-mono text-[10px] text-[var(--text-faint)]">
              {job.legacyJobId}
            </span>
          </span>
        </button>
        <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
          {t("agents.cron.quarantinePriorResults", {
            n: job.priorResultCount,
          })}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="mb-2 text-[11px] text-[var(--status-warning)]">
            {t("agents.cron.quarantineReviewWarning")}
          </p>
          {detailQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
          ) : detailQuery.isError ? (
            <p className="text-xs text-[var(--status-error)]">
              {t("agents.cron.quarantineDetailError")}
            </p>
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg)] p-2 text-[10px] text-[var(--text-muted)]">
              {JSON.stringify(detailQuery.data?.originalDefinition, null, 2)}
            </pre>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void exportDefinition()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("agents.cron.quarantineExport")}
            </button>
            <button
              type="button"
              onClick={deleteDefinition}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("agents.cron.quarantineDelete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function safeFilename(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "legacy-job";
}
