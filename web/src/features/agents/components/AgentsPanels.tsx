import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Puzzle,
  Save,
  Trash2,
  UserCircle,
  X,
  XCircle,
} from "lucide-react";
import {
  useAgentEnvironment,
  useAgentIdentity,
  useAgentMemory,
  useAgentSessions,
  useAgentSkills,
  useAgentStatus,
  useCreateCronJob,
  useCronBlueprints,
  useCronJobs,
  useCronResults,
  useDeleteCronJob,
  useDeleteAgentSession,
  useInstantiateCronBlueprint,
  usePauseCronJob,
  useResumeCronJob,
  useTriggerCronJob,
  useUpdateCronJob,
  type CronBlueprint,
  type CronBlueprintField,
} from "@/features/agent-ops/api";
import { cn } from "@/lib/utils";
import type {
  CronJob,
  CronResult,
  HermesSession,
  HermesSkill,
} from "@/types/agent-ops";

/* --------------------------------- Tab Button -------------------------------- */

export function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150",
        active
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}

/* --------------------------------- Overview Tab ------------------------------- */

export function OverviewTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentStatus(instanceId, profile);

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
        {t("agents.overview.loadError")}
      </div>
    );
  }

  const { gateway } = data;

  return (
    <div className="max-w-2xl space-y-4">
      {/* Gateway status card */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-3">
          {gateway.running ? (
            <CheckCircle2
              className="h-5 w-5 text-[var(--status-success, #22c55e)]"
              strokeWidth={1.75}
            />
          ) : (
            <XCircle
              className="h-5 w-5 text-[var(--status-error)]"
              strokeWidth={1.75}
            />
          )}
          <div className="flex-1">
            <div className="text-sm font-medium text-[var(--text)]">
              {t("agents.overview.gateway")}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {gateway.running
                ? t("agents.overview.gatewayRunning")
                : t("agents.overview.gatewayStopped")}
            </div>
          </div>
        </div>

        {/* Guidance when gateway is off */}
        {!gateway.running && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-[var(--status-error)]/10 p-3 text-xs text-[var(--text-muted)]">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-error)]"
              strokeWidth={1.75}
            />
            <div>
              <p>{t("agents.overview.gatewayOffHint")}</p>
              <code className="mt-1 block rounded bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text)]">
                hermes gateway install
              </code>
            </div>
          </div>
        )}
      </div>

      {/* Model info */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text)]">
          {t("agents.overview.modelInfo")}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <InfoField
            label={t("agents.overview.model")}
            value={gateway.model ?? "—"}
          />
          <InfoField
            label={t("agents.overview.provider")}
            value={gateway.provider ?? "—"}
          />
        </dl>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 font-mono text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}

/* ----------------------------------- Cron Tab -------------------------------- */

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
      {/* Scheduler status banner */}
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

      {/* Job list */}
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

function splitNames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function blueprintFields(blueprint: CronBlueprint) {
  return blueprint.formSchema.fields ?? [];
}

function CronJobForm({
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
      updateMutation.mutate(
        { id: job.id, body },
        { onSuccess: onClose },
      );
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
            onChange={(event) => setMode(event.target.value as "agent" | "no_agent")}
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

function CronBlueprintPanel({ blueprints }: { blueprints: CronBlueprint[] }) {
  const { t } = useTranslation();
  if (blueprints.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 text-sm font-medium text-[var(--text)]">
        {t("agents.cron.blueprints")}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {blueprints.slice(0, 6).map((blueprint) => (
          <CronBlueprintCard key={blueprint.key} blueprint={blueprint} />
        ))}
      </div>
    </div>
  );
}

function CronBlueprintCard({ blueprint }: { blueprint: CronBlueprint }) {
  const { t } = useTranslation();
  const instantiateMutation = useInstantiateCronBlueprint();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      blueprintFields(blueprint).map((field) => [
        field.name,
        field.default ?? (field.type === "boolean" ? false : ""),
      ]),
    ),
  );

  function instantiate() {
    instantiateMutation.mutate(
      {
        key: blueprint.key,
        values,
        title: blueprint.title,
        schedule: blueprint.defaultSchedule,
        enabled: true,
      },
      { onSuccess: () => setExpanded(false) },
    );
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {blueprint.title}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">
            {blueprint.description}
          </p>
          <code className="mt-2 inline-block rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
            {blueprint.defaultSchedule}
          </code>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {expanded ? t("agents.cron.cancel") : t("agents.cron.use")}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {blueprintFields(blueprint).map((field) => (
            <BlueprintField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(value) =>
                setValues((current) => ({ ...current, [field.name]: value }))
              }
            />
          ))}
          <div className="flex items-center justify-end gap-2">
            {instantiateMutation.isError && (
              <span className="mr-auto text-xs text-[var(--danger)]">
                {t("agents.cron.saveFailed")}
              </span>
            )}
            <button
              type="button"
              onClick={instantiate}
              disabled={instantiateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {instantiateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {t("agents.cron.createFromBlueprint")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BlueprintField({
  field,
  value,
  onChange,
}: {
  field: CronBlueprintField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        {field.name}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  return (
    <label className="block space-y-1 text-xs text-[var(--text-muted)]">
      {field.name}
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

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
            {job.deliver && (
              <span>
                {t("agents.cron.deliver")}: {job.deliver}
              </span>
            )}
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

function CronResultsPanel({ results }: { results: CronResult[] }) {
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

/* ------------------------------- Loading / Error ------------------------------ */

export function TabLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
      {t("common.loading")}
    </div>
  );
}

export function TabError({ message }: { message: string }) {
  return <div className="text-sm text-[var(--status-error)]">{message}</div>;
}

export function EmptyState({
  icon: Icon,
  message,
}: {
  icon: typeof Bot;
  message: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
      <Icon
        className="mx-auto mb-2 h-6 w-6 text-[var(--text-faint)]"
        strokeWidth={1.5}
      />
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
    </div>
  );
}

/* --------------------------------- Sessions Tab ------------------------------- */

export function SessionsTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentSessions(instanceId, profile);

  if (isLoading) return <TabLoading />;
  if (isError || !data)
    return <TabError message={t("agents.sessions.loadError")} />;

  const { sessions } = data;

  if (sessions.length === 0)
    return <EmptyState icon={MessageSquare} message={t("agents.sessions.empty")} />;

  return (
    <div className="max-w-3xl space-y-2">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          instanceId={instanceId}
          profile={profile}
        />
      ))}
    </div>
  );
}

export function SessionRow({
  session,
  instanceId,
  profile,
}: {
  session: HermesSession;
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const deleteSession = useDeleteAgentSession(instanceId, profile);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = () => {
    deleteSession.mutate(session.id, {
      onSuccess: () => setConfirming(false),
    });
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[var(--text)]">
            {session.title ?? session.id}
          </p>
          {session.lastActive && (
            <p className="mt-0.5 text-xs text-[var(--text-faint)]">
              {session.lastActive}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <code className="rounded bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
            {session.id}
          </code>
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteSession.isPending}
                className="rounded bg-[var(--status-error)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleteSession.isPending
                  ? t("agents.sessions.deleting")
                  : t("agents.sessions.confirmDelete")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleteSession.isPending}
                className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
              >
                {t("agents.sessions.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded p-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
              title={t("agents.sessions.delete")}
              aria-label={t("agents.sessions.delete")}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>
      {deleteSession.isError && (
        <p className="mt-2 text-xs text-[var(--status-error)]">
          {t("agents.sessions.deleteError")}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------- Skills Tab ------------------------------- */

export function SkillsTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentSkills(instanceId, profile);

  if (isLoading) return <TabLoading />;
  if (isError || !data)
    return <TabError message={t("agents.skills.loadError")} />;

  const { skills } = data;

  if (skills.length === 0)
    return <EmptyState icon={Puzzle} message={t("agents.skills.empty")} />;

  return (
    <div className="max-w-4xl">
      <div className="mb-3 text-xs text-[var(--text-muted)]">
        {t("agents.skills.count", { n: skills.length })}
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--surface-hover)] text-[var(--text-faint)]">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("agents.skills.name")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("agents.skills.category")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("agents.skills.source")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("agents.skills.trust")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("agents.skills.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <SkillRow key={skill.name} skill={skill} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SkillRow({ skill }: { skill: HermesSkill }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-3 py-2 font-mono text-[var(--text)]">{skill.name}</td>
      <td className="px-3 py-2 text-[var(--text-muted)]">
        {skill.category ?? "—"}
      </td>
      <td className="px-3 py-2 text-[var(--text-muted)]">
        {skill.source ?? "—"}
      </td>
      <td className="px-3 py-2 text-[var(--text-muted)]">
        {skill.trust ?? "—"}
      </td>
      <td className="px-3 py-2">
        {skill.status ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              skill.status === "enabled"
                ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                : "bg-[var(--surface-active)] text-[var(--text-muted)]",
            )}
          >
            {skill.status}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

/* ----------------------------------- Memory Tab ------------------------------- */

export function MemoryTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentMemory(instanceId, profile);

  if (isLoading) return <TabLoading />;
  if (isError || !data)
    return <TabError message={t("agents.memory.loadError")} />;

  const { memory } = data;

  return (
    <div className="max-w-2xl space-y-4">
      {/* Builtin memory status */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-3">
          {memory.builtinActive ? (
            <CheckCircle2
              className="h-5 w-5 text-[var(--status-success,#22c55e)]"
              strokeWidth={1.75}
            />
          ) : (
            <XCircle
              className="h-5 w-5 text-[var(--status-error)]"
              strokeWidth={1.75}
            />
          )}
          <div>
            <div className="text-sm font-medium text-[var(--text)]">
              {t("agents.memory.builtin")}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {memory.builtinActive
                ? t("agents.memory.active")
                : t("agents.memory.inactive")}
            </div>
          </div>
        </div>
      </div>

      {/* Installed memory plugins */}
      {memory.installedPlugins.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 text-sm font-medium text-[var(--text)]">
            {t("agents.memory.plugins")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {memory.installedPlugins.map((plugin) => (
              <span
                key={plugin}
                className="rounded bg-[var(--surface-hover)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]"
              >
                {plugin}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* User memory content */}
      {memory.userMemory && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 text-sm font-medium text-[var(--text)]">
            {t("agents.memory.userMemory")}
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-muted)]">
            {memory.userMemory}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Identity Tab ------------------------------ */

export function IdentityTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentIdentity(instanceId, profile);

  if (isLoading) return <TabLoading />;
  if (isError || !data)
    return <TabError message={t("agents.identity.loadError")} />;

  const { identity } = data;

  if (!identity.name && !identity.role && !identity.content)
    return <EmptyState icon={UserCircle} message={t("agents.identity.empty")} />;

  return (
    <div className="max-w-2xl space-y-4">
      {/* Identity card */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-hover)]">
            <UserCircle
              className="h-6 w-6 text-[var(--text)]"
              strokeWidth={1.5}
            />
          </div>
          <div>
            <div className="text-base font-semibold text-[var(--text)]">
              {identity.name ?? t("agents.identity.unnamed")}
            </div>
            {identity.role && (
              <div className="text-xs text-[var(--text-muted)]">
                {identity.role}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full SOUL.md content */}
      {identity.content && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 text-sm font-medium text-[var(--text)]">
            {t("agents.identity.soul")}
          </div>
          <pre className="max-h-[500px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--text-muted)]">
            {identity.content}
          </pre>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Environment Tab ----------------------------- */

export function EnvironmentTab({
  instanceId,
  profile,
}: {
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentEnvironment(
    instanceId,
    profile,
  );

  if (isLoading) return <TabLoading />;
  if (isError || !data)
    return <TabError message={t("agents.environment.loadError")} />;

  const { environment } = data;

  return (
    <div className="max-w-3xl space-y-4">
      {/* Runtime info */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text)]">
          {t("agents.environment.runtime")}
        </div>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
          <InfoField
            label={t("agents.environment.python")}
            value={environment.python ?? "—"}
          />
          <InfoField
            label={t("agents.environment.model")}
            value={environment.model ?? "—"}
          />
          <InfoField
            label={t("agents.environment.provider")}
            value={environment.provider ?? "—"}
          />
        </dl>
      </div>

      {/* API keys */}
      {environment.apiKeys.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 text-sm font-medium text-[var(--text)]">
            {t("agents.environment.apiKeys")}
          </div>
          <div className="space-y-1.5">
            {environment.apiKeys.map((key) => (
              <div
                key={key.name}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-[var(--text-muted)]">{key.name}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-mono",
                    key.configured
                      ? "text-[var(--status-success,#22c55e)]"
                      : "text-[var(--text-faint)]",
                  )}
                >
                  {key.configured ? (
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <XCircle className="h-3 w-3" strokeWidth={2} />
                  )}
                  {key.detail ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auth providers */}
      {environment.authProviders.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-3 text-sm font-medium text-[var(--text)]">
            {t("agents.environment.authProviders")}
          </div>
          <div className="space-y-1.5">
            {environment.authProviders.map((auth) => (
              <div
                key={auth.name}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-[var(--text-muted)]">{auth.name}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-mono",
                    auth.loggedIn
                      ? "text-[var(--status-success,#22c55e)]"
                      : "text-[var(--text-faint)]",
                  )}
                >
                  {auth.loggedIn ? (
                    <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                  ) : (
                    <XCircle className="h-3 w-3" strokeWidth={2} />
                  )}
                  {auth.detail ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
