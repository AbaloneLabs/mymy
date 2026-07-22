import { useTranslation } from "react-i18next";
import { Clock, MessageSquare, ScrollText } from "lucide-react";
import { useCronJobs } from "@/features/agent-ops/api";
import { useChatSessions } from "@/features/chat/api";
import type { Agent } from "@/types/agents";
import { CompactSessionList } from "./AgentsCompactSessionList";
import {
  AgentAvatar,
  AgentStatusDot,
  SummaryTile,
} from "./AgentsNativeShared";
import { ProactivePanel } from "./AgentsProactivePanel";
import { RunActivity } from "./AgentsRunActivity";
import { AgentLlmSettingsPanel } from "./AgentsLlmSettingsPanel";

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

      {agent && (
        <AgentLlmSettingsPanel
          key={`${agent.profile}:${agent.llmSettings.providerId ?? "default"}:${agent.llmSettings.model ?? "default"}`}
          agent={agent}
        />
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text)]">
          {t("agents.overview.recentSessions")}
        </div>
        <CompactSessionList sessions={sessions.slice(0, 5)} showProfile={false} />
      </section>

      <ProactivePanel profile={profile} />
      <RunActivity agents={agent ? [agent] : []} profile={profile} />
    </div>
  );
}
