import { useTranslation } from "react-i18next";
import { Bot, Clock, MessageSquare } from "lucide-react";
import { useCronJobs } from "@/features/agent-ops/api";
import { useChatSessions } from "@/features/chat/api";
import type { Agent } from "@/types/agents";
import { SummaryTile } from "./AgentsNativeShared";
import { RunActivity } from "./AgentsRunActivity";

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

      <RunActivity agents={agents} />
    </div>
  );
}
