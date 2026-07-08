import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Clock, MessageSquare } from "lucide-react";
import { useCronJobs } from "@/features/agent-ops/api";
import { useChatSessions } from "@/features/chat/api";
import type { Agent } from "@/types/agents";
import { SummaryTile } from "./AgentsNativeShared";
import { formatDate } from "./AgentsNativeUtils";

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
