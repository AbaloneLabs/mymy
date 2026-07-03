import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  ScrollText,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  useCronJobs,
} from "@/features/agent-ops/api";
import { useCreateAgent, useDeleteAgent } from "@/features/agents/api";
import { useChatSessions } from "@/features/chat/api";
import {
  useSandboxProcessLogs,
  useSandboxProcesses,
  useSandboxRuntime,
  useStartSandboxProcess,
  useStopSandboxProcess,
} from "@/features/sandbox/api";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type { Agent } from "@/types/agents";
import type { ChatSession } from "@/types/chat";
import type { SandboxProcess } from "@/types/sandbox";
import {
  AgentAvatar,
  AgentStatusDot,
  EmptyState,
  Metric,
  PanelError,
  PanelLoading,
  SummaryTile,
} from "./AgentsNativeShared";
import { formatDate, profileFromAgent } from "./AgentsNativeUtils";

export { PromptTab } from "./AgentsPromptTab";

export function AllAgentsOverviewTab({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation();
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions(
    undefined,
    undefined,
  );
  const { data: cronData, isLoading: cronLoading } = useCronJobs(null, null);
  const sessions = sessionsData?.sessions ?? [];
  const jobs = cronData?.jobs ?? [];
  const activeJobs = jobs.filter((job) => !job.paused).length;
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(agent.profile, agent);
    }
    return map;
  }, [agents]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile
          icon={Bot}
          label={t("agents.dashboard.totalAgents")}
          value={String(agents.length)}
        />
        <SummaryTile
          icon={MessageSquare}
          label={t("agents.dashboard.totalSessions")}
          value={sessionsLoading ? "..." : String(sessions.length)}
        />
        <SummaryTile
          icon={Clock}
          label={t("agents.dashboard.activeJobs")}
          value={cronLoading ? "..." : String(activeJobs)}
        />
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text)]">
          {t("agents.dashboard.recentActivity")}
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
            {t("agents.dashboard.noActivity")}
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 8).map((session) => {
              const agent = agentMap.get(session.profile);
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--text)]">
                      {session.title || t("chat.newSession")}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--text-faint)]">
                      <span>{agent?.name ?? session.profile}</span>
                      <span>{t("agents.sessions.messages", { n: session.messageCount })}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {formatDate(session.updatedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function AllAgentsTab({
  agents,
  onSelectAgent,
}: {
  agents: Agent[];
  onSelectAgent: (profile: string) => void;
}) {
  const { t } = useTranslation();
  const selectedAgentProfile = useProjectContext(
    (s) => s.selectedAgentProfile,
  );
  const setSelectedAgentProfile = useProjectContext(
    (s) => s.setSelectedAgentProfile,
  );
  const deleteAgent = useDeleteAgent();
  const { data: sessionsData } = useChatSessions(undefined, undefined);
  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessionsData?.sessions ?? []) {
      counts.set(session.profile, (counts.get(session.profile) ?? 0) + 1);
    }
    return counts;
  }, [sessionsData]);

  function handleDeleteAgent(profile: string, name: string) {
    if (!window.confirm(t("agents.all.deleteConfirm", { name }))) return;
    deleteAgent.mutate(profile, {
      onSuccess: () => {
        if (selectedAgentProfile === profile) {
          setSelectedAgentProfile(null);
        }
      },
    });
  }

  return (
    <div className="max-w-6xl space-y-4">
      <CreateAgentPanel onCreated={onSelectAgent} />

      {deleteAgent.isError && (
        <div className="text-sm text-[var(--status-error)]">
          {t("agents.all.deleteError")}
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={t("agents.all.emptyTitle")}
          message={t("agents.all.empty")}
        />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const profile = profileFromAgent(agent);
            const deleting =
              deleteAgent.isPending && deleteAgent.variables === profile;
            return (
              <section
                key={agent.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectAgent(profile)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <AgentAvatar agent={agent} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--text)]">
                          {agent.name}
                        </span>
                        <AgentStatusDot status={agent.status} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                        {agent.role || profile}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteAgent(profile, agent.name)}
                    disabled={deleting}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("agents.all.delete")}
                    title={t("agents.all.delete")}
                  >
                    {deleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectAgent(profile)}
                  className="mt-3 grid w-full grid-cols-2 gap-2 text-left text-xs"
                >
                  <Metric label={t("agents.all.profile")} value={profile} mono />
                  <Metric
                    label={t("agents.all.sessions")}
                    value={String(sessionCounts.get(profile) ?? 0)}
                  />
                </button>
                {agent.description && (
                  <p className="mt-3 line-clamp-2 text-xs text-[var(--text-muted)]">
                    {agent.description}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateAgentPanel({
  onCreated,
}: {
  onCreated: (profile: string) => void;
}) {
  const { t } = useTranslation();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const busy = createAgent.isPending;
  const canSubmit = name.trim().length > 0 && !busy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    createAgent.mutate(
      {
        name,
        profile: profile.trim() || undefined,
        role: role.trim() || undefined,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setName("");
          setProfile("");
          setRole("");
          setDescription("");
          onCreated(res.agent.profile);
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Plus className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
        {t("agents.all.addTitle")}
      </div>
      <form onSubmit={handleSubmit} className="grid gap-3 lg:grid-cols-4">
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.name")}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.profileOptional")}
          </span>
          <input
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.role")}
          </span>
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            maxLength={120}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("agents.all.description")}
          </span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex items-end gap-2 lg:col-span-4">
          {createAgent.isError && (
            <span className="text-xs text-[var(--status-error)]">
              {t("agents.all.createError")}
            </span>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t("agents.all.create")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function AgentOverviewTab({
  agent,
  profile,
}: {
  agent?: Agent;
  profile: string;
}) {
  const { t } = useTranslation();
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions(
    undefined,
    profile,
  );
  const { data: cronData, isLoading: cronLoading } = useCronJobs(null, profile);

  const sessions = sessionsData?.sessions ?? [];
  const jobs = cronData?.jobs ?? [];
  const activeJobs = jobs.filter((job) => !job.paused).length;

  return (
    <div className="max-w-5xl space-y-4">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <AgentAvatar agent={agent} profile={profile} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-[var(--text)]">
                {agent?.name ?? profile}
              </h2>
              {agent && <AgentStatusDot status={agent.status} />}
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {agent?.role || t("agents.overview.nativeRuntime")}
            </p>
          </div>
          <code className="rounded bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
            {profile}
          </code>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile
          icon={MessageSquare}
          label={t("agents.overview.sessions")}
          value={sessionsLoading ? "..." : String(sessions.length)}
        />
        <SummaryTile
          icon={Clock}
          label={t("agents.overview.activeJobs")}
          value={cronLoading ? "..." : String(activeJobs)}
        />
        <SummaryTile
          icon={ScrollText}
          label={t("agents.overview.prompt")}
          value={t("agents.overview.configurable")}
        />
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text)]">
          {t("agents.overview.recentSessions")}
        </div>
        <CompactSessionList sessions={sessions.slice(0, 5)} showProfile={false} />
      </section>
    </div>
  );
}

export function SandboxProcessesTab({
  profile,
  agents,
}: {
  profile: string | null;
  agents: Agent[];
}) {
  const { t } = useTranslation();
  const selectedProjectId = useProjectContext((s) => s.selectedProjectId);
  const runtime = useSandboxRuntime();
  const processes = useSandboxProcesses(profile, selectedProjectId);
  const startProcess = useStartSandboxProcess();
  const stopProcess = useStopSandboxProcess();
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const logs = useSandboxProcessLogs(selectedProcessId);
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(profileFromAgent(agent), agent);
    }
    return map;
  }, [agents]);
  const rows = processes.data?.processes ?? [];
  const canStart = Boolean(profile && command.trim() && !startProcess.isPending);

  function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canStart) return;
    startProcess.mutate(
      {
        agentProfile: profile,
        projectId: selectedProjectId ?? undefined,
        command: command.trim(),
        cwd: cwd.trim() || undefined,
        port: port.trim() ? Number(port) : undefined,
        label: label.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setCommand("");
          setCwd("");
          setPort("");
          setLabel("");
          setSelectedProcessId(res.process.id);
        },
      },
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--text)]">
              {t("agents.sandbox.runtime")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {runtime.data?.runtime.mode ?? "unknown"}
              {runtime.data?.runtime.dataRoot ? ` · ${runtime.data.runtime.dataRoot}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SandboxStatusPill
              status={runtime.data?.runtime.ready ? "ready" : "unavailable"}
            />
            <button
              type="button"
              onClick={() => {
                runtime.refetch();
                processes.refetch();
              }}
              className="h-8 w-8 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              title={t("common.refresh")}
            >
              <RefreshCw className="mx-auto h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {runtime.data?.runtime.error && (
          <p className="mt-2 text-xs text-[var(--status-error)]">
            {runtime.data.runtime.error}
          </p>
        )}
      </section>

      {profile && (
        <form
          onSubmit={handleStart}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
            <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
            {t("agents.sandbox.startProcess")}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_minmax(0,1fr)_auto]">
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={t("agents.sandbox.command")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={t("agents.sandbox.cwd")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
              placeholder={t("agents.sandbox.port")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("agents.sandbox.label")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={!canStart}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startProcess.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={1.5} />
              )}
              {t("agents.sandbox.start")}
            </button>
          </div>
          {startProcess.isError && (
            <p className="mt-2 text-xs text-[var(--status-error)]">
              {t("agents.sandbox.startError")}
            </p>
          )}
        </form>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--text)]">
            {t("agents.sandbox.processes")}
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {t("common.units", { count: rows.length })}
          </span>
        </div>
        {processes.isLoading ? (
          <div className="p-4">
            <PanelLoading />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Terminal}
              title={t("agents.sandbox.emptyTitle")}
              message={t("agents.sandbox.empty")}
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((process) => {
              const agent = agentMap.get(process.agentProfile);
              const running = process.status === "running" || process.status === "starting";
              return (
                <div key={process.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedProcessId(process.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <SandboxStatusPill status={process.status} />
                        {!profile && (
                          <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                            {agent?.name ?? process.agentProfile}
                          </span>
                        )}
                        {process.pid && (
                          <span className="text-[11px] text-[var(--text-faint)]">
                            PID {process.pid}
                          </span>
                        )}
                      </div>
                      <code className="mt-2 block truncate font-mono text-xs text-[var(--text)]">
                        {process.command}
                      </code>
                      <p className="mt-1 truncate text-[11px] text-[var(--text-faint)]">
                        {process.cwd} · {formatDate(process.startedAt)}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {process.previewPath && (
                        <a
                          href={previewHref(process.previewPath)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]"
                          title={t("agents.sandbox.openPreview")}
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => stopProcess.mutate(process.id)}
                        disabled={!running || stopProcess.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
                        title={t("agents.sandbox.stop")}
                      >
                        <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedProcessId && (
        <ProcessLogsPanel
          process={rows.find((row) => row.id === selectedProcessId)}
          logs={logs.data?.logs ?? ""}
          loading={logs.isLoading}
          onClose={() => setSelectedProcessId(null)}
        />
      )}
    </div>
  );
}

export function NativeSessionsTab({
  profile,
  agents,
}: {
  profile: string | null;
  agents: Agent[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSelectedAgentProfile = useProjectContext(
    (s) => s.setSelectedAgentProfile,
  );
  const { data, isLoading, isError } = useChatSessions(
    undefined,
    profile ?? undefined,
  );
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(profileFromAgent(agent), agent);
    }
    return map;
  }, [agents]);

  if (isLoading) return <PanelLoading />;
  if (isError) return <PanelError message={t("agents.sessions.loadError")} />;

  const sessions = data?.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={t("agents.sessions.emptyTitle")}
        message={t("agents.sessions.empty")}
      />
    );
  }

  return (
    <div className="max-w-5xl space-y-2">
      {sessions.map((session) => {
        const agent = agentMap.get(session.profile);
        return (
          <div
            key={session.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--text)]">
                  {session.title || t("chat.newSession")}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                  {!profile && (
                    <span className="rounded bg-[var(--bg)] px-1.5 py-0.5">
                      {agent?.name ?? session.profile}
                    </span>
                  )}
                  <span>{t("agents.sessions.messages", { n: session.messageCount })}</span>
                  <span>{formatDate(session.updatedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAgentProfile(agent?.profile ?? null);
                  navigate("/chat");
                }}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                {t("agents.sessions.open")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProcessLogsPanel({
  process,
  logs,
  loading,
  onClose,
}: {
  process?: SandboxProcess;
  logs: string;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">
            {t("agents.sandbox.logs")}
          </h2>
          {process && (
            <code className="mt-1 block truncate font-mono text-[11px] text-[var(--text-faint)]">
              {process.command}
            </code>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.cancel")}
        </button>
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
        {loading ? t("common.loading") : logs || t("agents.sandbox.noLogs")}
      </pre>
    </section>
  );
}

function SandboxStatusPill({ status }: { status: string }) {
  const tone =
    status === "ready" || status === "running" || status === "done"
      ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
      : status === "failed" || status === "unavailable"
        ? "bg-[var(--status-error)]/10 text-[var(--status-error)]"
        : "bg-[var(--surface-hover)] text-[var(--text-muted)]";
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>
      {status}
    </span>
  );
}

function previewHref(path: string) {
  if (path.startsWith("/api/")) {
    return `${API_BASE.replace(/\/api$/, "")}${path}`;
  }
  return `${API_BASE}${path}`;
}

function CompactSessionList({
  sessions,
  showProfile,
}: {
  sessions: ChatSession[];
  showProfile: boolean;
}) {
  const { t } = useTranslation();
  if (sessions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
        {t("agents.sessions.empty")}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-[var(--text)]">
              {session.title || t("chat.newSession")}
            </div>
            <div className="mt-0.5 flex gap-2 text-[11px] text-[var(--text-faint)]">
              {showProfile && <span>{session.profile}</span>}
              <span>{formatDate(session.updatedAt)}</span>
            </div>
          </div>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
            {session.messageCount}
          </span>
        </div>
      ))}
    </div>
  );
}
