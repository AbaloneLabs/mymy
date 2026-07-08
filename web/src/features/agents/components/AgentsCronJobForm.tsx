import { useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCreateCronJob,
  useUpdateCronJob,
} from "@/features/agent-ops/api";
import type { CronJob } from "@/types/agent-ops";

export function CronJobForm({
  job,
  onClose,
}: {
  job?: CronJob;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMutation = useCreateCronJob();
  const updateMutation = useUpdateCronJob();
  const [title, setTitle] = useState(job?.name ?? "");
  const [prompt, setPrompt] = useState(job?.prompt ?? "");
  const [schedule, setSchedule] = useState(job?.schedule ?? "");
  const [mode, setMode] = useState<"agent" | "no_agent">(
    job?.deliver === "no_agent" ? "no_agent" : "agent",
  );
  const [skills, setSkills] = useState(job?.skill ?? "");
  const busy = createMutation.isPending || updateMutation.isPending;

  function save() {
    const body = {
      title,
      prompt,
      schedule,
      mode,
      enabled: !job?.paused,
      skills: splitNames(skills),
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
          {t("agents.cron.mode")}
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "agent" | "no_agent")
            }
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="agent">agent</option>
            <option value="no_agent">no_agent</option>
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
          disabled={busy || !title.trim() || !prompt.trim() || !schedule.trim()}
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
