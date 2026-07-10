import { useState } from "react";
import { Pause, Play, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDeleteCronJob,
  usePauseCronJob,
  useResumeCronJob,
  useTriggerCronJob,
} from "@/features/agent-ops/api";
import type { CronJob } from "@/types/agent-ops";
import { CronJobForm } from "./AgentsCronJobForm";

export function CronJobCard({ job }: { job: CronJob }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const pauseMutation = usePauseCronJob();
  const resumeMutation = useResumeCronJob();
  const triggerMutation = useTriggerCronJob();
  const deleteMutation = useDeleteCronJob();
  const busy =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    triggerMutation.isPending ||
    deleteMutation.isPending;

  function deleteJob() {
    if (window.confirm(t("agents.cron.confirmDelete"))) {
      deleteMutation.mutate(job.id);
    }
  }

  if (editing) {
    return <CronJobForm job={job} onClose={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--text)]">
              {job.name ?? t("agents.cron.untitled")}
            </span>
            {job.paused && (
              <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                <Pause className="h-2.5 w-2.5" strokeWidth={2} />
                {t("agents.cron.paused")}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
            <span className="font-mono">{job.schedule}</span>
            {job.nextRun && (
              <span>
                {t("agents.cron.nextRun")}: {job.nextRun}
              </span>
            )}
          </div>
          {job.prompt && (
            <p className="mt-1.5 line-clamp-2 text-xs text-[var(--text-faint)]">
              {job.prompt}
            </p>
          )}
        </div>
        <code className="shrink-0 rounded bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
          {job.id}
        </code>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => triggerMutation.mutate(job.id)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("agents.cron.trigger")}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("agents.cron.edit")}
        </button>
        {job.paused ? (
          <button
            type="button"
            onClick={() => resumeMutation.mutate(job.id)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("agents.cron.resume")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => pauseMutation.mutate(job.id)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("agents.cron.pause")}
          </button>
        )}
        <button
          type="button"
          onClick={deleteJob}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("agents.cron.delete")}
        </button>
      </div>
    </div>
  );
}
