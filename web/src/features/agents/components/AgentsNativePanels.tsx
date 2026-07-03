import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  ScrollText,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  type AgentPromptsResponse,
  useAgentPrompts,
  useCronJobs,
  useUpdateAgentPrompts,
} from "@/features/agent-ops/api";
import { useCreateAgent, useDeleteAgent } from "@/features/agents/api";
import { useChatSessions } from "@/features/chat/api";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type { Agent } from "@/types/agents";
import type { ChatSession } from "@/types/chat";

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

export function PromptTab({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAgentPrompts(profile);

  if (isLoading) return <PanelLoading />;
  if (isError || !data) return <PanelError message={t("agents.prompt.loadError")} />;

  return (
    <PromptEditorForm
      key={[
        data.profile,
        data.agentsMd.updatedAt ?? "new-agents",
        data.soulMd.updatedAt ?? "new-soul",
      ].join(":")}
      profile={profile}
      data={data}
    />
  );
}

function PromptEditorForm({
  profile,
  data,
}: {
  profile: string;
  data: AgentPromptsResponse;
}) {
  const { t } = useTranslation();
  const updateMutation = useUpdateAgentPrompts(profile);
  const [agentsDraft, setAgentsDraft] = useState(data.agentsMd.content);
  const [soulDraft, setSoulDraft] = useState(data.soulMd.content);
  const dirty =
    agentsDraft !== data.agentsMd.content || soulDraft !== data.soulMd.content;
  const busy = updateMutation.isPending;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <PromptEditor
          title="AGENTS.md"
          path={data.agentsMd.path}
          exists={data.agentsMd.exists}
          updatedAt={data.agentsMd.updatedAt}
          value={agentsDraft}
          onChange={setAgentsDraft}
        />
        <PromptEditor
          title="SOUL.md"
          path={data.soulMd.path}
          exists={data.soulMd.exists}
          updatedAt={data.soulMd.updatedAt}
          value={soulDraft}
          onChange={setSoulDraft}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {updateMutation.isError && (
          <span className="mr-auto text-xs text-[var(--status-error)]">
            {t("agents.prompt.saveError")}
          </span>
        )}
        {updateMutation.isSuccess && !dirty && (
          <span className="mr-auto text-xs text-[var(--status-success)]">
            {t("agents.prompt.saved")}
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            updateMutation.mutate({
              agentsMd: agentsDraft,
              soulMd: soulDraft,
            })
          }
          disabled={!dirty || busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("agents.prompt.save")}
        </button>
      </div>
    </div>
  );
}

function PromptEditor({
  title,
  path,
  exists,
  updatedAt,
  value,
  onChange,
}: {
  title: string;
  path: string;
  exists: boolean;
  updatedAt?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">{title}</h2>
          <code className="mt-1 block truncate font-mono text-[11px] text-[var(--text-faint)]">
            {path}
          </code>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
            exists
              ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
              : "bg-[var(--surface-hover)] text-[var(--text-muted)]",
          )}
        >
          {exists ? t("agents.prompt.exists") : t("agents.prompt.newFile")}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="h-[460px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      {updatedAt && (
        <div className="mt-2 text-[11px] text-[var(--text-faint)]">
          {t("agents.prompt.updated")}: {formatDate(updatedAt)}
        </div>
      )}
    </section>
  );
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

function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-active)] text-[var(--text-muted)]">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-faint)]">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate text-xs text-[var(--text-muted)]",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function AgentAvatar({ agent, profile }: { agent?: Agent; profile?: string }) {
  const label = agent?.name ?? profile ?? "?";
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-active)] text-sm font-semibold text-[var(--text)]">
      {label.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function AgentStatusDot({ status }: { status: Agent["status"] }) {
  return status === "active" ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-success)]" strokeWidth={1.75} />
  ) : status === "offline" ? (
    <XCircle className="h-3.5 w-3.5 text-[var(--status-error)]" strokeWidth={1.75} />
  ) : (
    <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
  );
}

function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
      {t("common.loading")}
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return <div className="text-sm text-[var(--status-error)]">{message}</div>;
}

function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof Bot;
  title: string;
  message: string;
}) {
  return (
    <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
      <div>
        <Icon
          className="mx-auto mb-3 h-6 w-6 text-[var(--text-faint)]"
          strokeWidth={1.5}
        />
        <div className="text-sm font-medium text-[var(--text)]">{title}</div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
  );
}

function profileFromAgent(agent: Agent): string {
  return agent.profile;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
