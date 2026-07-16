import { useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateCronJob,
  useUpdateCronJob,
} from "@/features/agent-ops/api";
import type { CronJob } from "@/types/agent-ops";
import { useProjectContext } from "@/store/projectContext";
import { useAgents } from "@/features/agents/api";

export function CronJobForm({
  job,
  defaultProfile,
  onClose,
}: {
  job?: CronJob;
  defaultProfile?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMutation = useCreateCronJob();
  const updateMutation = useUpdateCronJob();
  const { data: agentsData } = useAgents();
  const [title, setTitle] = useState(job?.name ?? "");
  const [prompt, setPrompt] = useState(job?.prompt ?? "");
  const [schedule, setSchedule] = useState(job?.schedule ?? "");
  const [skills, setSkills] = useState(job?.skill ?? "");
  const [catchUpPolicy, setCatchUpPolicy] = useState(job?.catchUpPolicy ?? "latest");
  const [retryPolicy, setRetryPolicy] = useState(job?.retryPolicy ?? "safe");
  const [agentProfile, setAgentProfile] = useState(
    job?.agentProfile ?? defaultProfile ?? "",
  );
  const [maxToolCalls, setMaxToolCalls] = useState(job?.maxToolCalls ?? 100);
  const [maxRuntimeSeconds, setMaxRuntimeSeconds] = useState(
    job?.maxRuntimeSeconds ?? 1_800,
  );
  const [maxTotalTokens, setMaxTotalTokens] = useState(
    job?.maxTotalTokens ?? 200_000,
  );
  const selectedProjectId = useProjectContext((state) => state.selectedProjectId);
  const busy = createMutation.isPending || updateMutation.isPending;

  function save() {
    const body = {
      title,
      prompt,
      schedule,
      enabled: !job?.paused,
      skills: splitNames(skills),
      agentProfile,
      projectId: job ? (job.projectId ?? null) : selectedProjectId,
      catchUpPolicy,
      retryPolicy,
      maxToolCalls,
      maxRuntimeSeconds,
      maxTotalTokens,
    };
    if (job) {
      updateMutation.mutate({ id: job.id, body }, { onSuccess: onClose });
    } else {
      createMutation.mutate(body, { onSuccess: onClose });
    }
  }

  const failed = createMutation.isError || updateMutation.isError;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.title")}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.schedule")}
          <input
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            placeholder="0 9 * * *"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>
      <label className="mt-3 block space-y-1 text-xs text-[var(--text-muted)]">
        {t("agents.cron.prompt")}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </label>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.agent")}
          <select
            value={agentProfile}
            onChange={(event) => setAgentProfile(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          >
            <option value="">{t("agents.cron.selectAgent")}</option>
            {(agentsData?.agents ?? []).map((agent) => (
              <option key={agent.profile} value={agent.profile}>
                {agent.name} ({agent.profile})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.skills")}
          <input
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
            placeholder="skill-one, skill-two"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.catchUpPolicy")}
          <select value={catchUpPolicy} onChange={(event) => setCatchUpPolicy(event.target.value as typeof catchUpPolicy)} className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]">
            <option value="skip">{t("agents.cron.catchUpSkip")}</option>
            <option value="latest">{t("agents.cron.catchUpLatest")}</option>
            <option value="all">{t("agents.cron.catchUpAll")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.retryPolicy")}
          <select value={retryPolicy} onChange={(event) => setRetryPolicy(event.target.value as typeof retryPolicy)} className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]">
            <option value="safe">{t("agents.cron.retrySafe")}</option>
            <option value="none">{t("agents.cron.retryNone")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.maxToolCalls")}
          <input
            type="number"
            min={1}
            max={1000}
            value={maxToolCalls}
            onChange={(event) => setMaxToolCalls(Number(event.target.value))}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.maxRuntimeSeconds")}
          <input
            type="number"
            min={1}
            max={86400}
            value={maxRuntimeSeconds}
            onChange={(event) => setMaxRuntimeSeconds(Number(event.target.value))}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("agents.cron.maxTotalTokens")}
          <input
            type="number"
            min={1000}
            max={2000000}
            value={maxTotalTokens}
            onChange={(event) => setMaxTotalTokens(Number(event.target.value))}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {failed && (
          <span className="mr-auto text-xs text-[var(--danger)]">
            {t("agents.cron.saveFailed")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("agents.cron.cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={
            busy ||
            !title.trim() ||
            !prompt.trim() ||
            !schedule.trim() ||
            !agentProfile ||
            !Number.isInteger(maxToolCalls) ||
            maxToolCalls < 1 ||
            maxToolCalls > 1000 ||
            !Number.isInteger(maxRuntimeSeconds) ||
            maxRuntimeSeconds < 1 ||
            maxRuntimeSeconds > 86400 ||
            !Number.isInteger(maxTotalTokens) ||
            maxTotalTokens < 1000 ||
            maxTotalTokens > 2000000
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("agents.cron.save")}
        </button>
      </div>
    </div>
  );
}

function splitNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
