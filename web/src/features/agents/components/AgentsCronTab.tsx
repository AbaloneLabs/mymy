import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
} from "lucide-react";
import {
  useCronBlueprints,
  useCronJobs,
  useCronResults,
} from "@/features/agent-ops/api";
import { cn } from "@/lib/utils";
import { CronBlueprintPanel } from "./AgentsCronBlueprints";
import { CronJobCard } from "./AgentsCronJobCard";
import { CronJobForm } from "./AgentsCronJobForm";
import { CronResultsPanel } from "./AgentsCronResults";
import { CronSecurityQuarantinePanel } from "./AgentsCronSecurityQuarantine";

export function CronTab({
  instanceId,
  profile,
}: {
  instanceId: string | null;
  profile: string | null;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCronJobs(instanceId, profile);
  const { data: resultsData } = useCronResults(8);
  const { data: blueprintsData } = useCronBlueprints();
  const [adding, setAdding] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("common.loading")}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="text-sm text-[var(--status-error)]">
        {t("agents.cron.loadError")}
      </div>
    );
  }

  const { jobs, status } = data;

  return (
    <div className="max-w-3xl space-y-4">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4",
          status.schedulerRunning
            ? "border-[var(--border)] bg-[var(--surface)]"
            : "border-[var(--status-error)]/30 bg-[var(--status-error)]/5",
        )}
      >
        {status.schedulerRunning ? (
          <CheckCircle2
            className="h-5 w-5 shrink-0 text-[var(--status-success, #22c55e)]"
            strokeWidth={1.75}
          />
        ) : (
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-[var(--status-error)]"
            strokeWidth={1.75}
          />
        )}
        <div className="flex-1">
          <div className="text-sm font-medium text-[var(--text)]">
            {status.schedulerRunning
              ? t("agents.cron.schedulerRunning")
              : t("agents.cron.schedulerStopped")}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("agents.cron.activeJobs", { n: status.activeJobs })}
          </div>
        </div>
      </div>

      <CronSecurityQuarantinePanel />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("agents.cron.add")}
        </button>
      </div>

      {adding && <CronJobForm onClose={() => setAdding(false)} />}

      <CronBlueprintPanel blueprints={blueprintsData?.blueprints ?? []} />

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
          <Clock
            className="mx-auto mb-2 h-6 w-6 text-[var(--text-faint)]"
            strokeWidth={1.5}
          />
          <p className="text-sm text-[var(--text-muted)]">
            {t("agents.cron.noJobs")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <CronJobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      <CronResultsPanel results={resultsData?.results ?? []} />
    </div>
  );
}
