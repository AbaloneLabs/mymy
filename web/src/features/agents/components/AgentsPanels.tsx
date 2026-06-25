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
  Puzzle,
  Trash2,
  UserCircle,
  XCircle,
} from "lucide-react";
import {
  useAgentEnvironment,
  useAgentIdentity,
  useAgentMemory,
  useAgentSessions,
  useAgentSkills,
  useAgentStatus,
  useCronJobs,
  useDeleteAgentSession,
} from "@/features/agent-ops/api";
import { cn } from "@/lib/utils";
import type { CronJob, HermesSession, HermesSkill } from "@/types/agent-ops";

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
  instanceId: string;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCronJobs(instanceId, profile);

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
    </div>
  );
}

export function CronJobCard({ job }: { job: CronJob }) {
  const { t } = useTranslation();
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
