import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import {
  AgentOverviewTab,
  AllAgentsOverviewTab,
  AllAgentsTab,
  NativeSessionsTab,
  PromptTab,
} from "@/features/agents/components/AgentsNativePanels";
import { CronTab, TabButton } from "@/features/agents/components/AgentsPanels";
import {
  ALL_AGENT_TABS,
  SINGLE_AGENT_TABS,
  TAB_ICONS,
  type AgentsTab,
} from "@/features/agents/components/agentsTabs";
import { useProjectContext } from "@/store/projectContext";

/**
 * Native agent operations page.
 *
 * The global TopBar agent picker is the only source of truth for scope. A null
 * selection means "all agents" and exposes only aggregate lists. A concrete
 * profile shows tabs for that selected agent.
 */
export default function AgentsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: agentsData } = useAgents();
  const agents = useMemo(() => agentsData?.agents ?? [], [agentsData]);
  const selectedAgentProfile = useProjectContext(
    (s) => s.selectedAgentProfile,
  );
  const setSelectedAgentProfile = useProjectContext(
    (s) => s.setSelectedAgentProfile,
  );

  const selectedAgent = useMemo(
    () =>
      selectedAgentProfile
        ? agents.find((agent) => agent.profile === selectedAgentProfile)
        : undefined,
    [agents, selectedAgentProfile],
  );
  const activeAgentProfile =
    selectedAgentProfile && (agentsData ? selectedAgent : true)
      ? selectedAgentProfile
      : null;

  useEffect(() => {
    if (selectedAgentProfile && agentsData && !selectedAgent) {
      setSelectedAgentProfile(null);
    }
  }, [agentsData, selectedAgent, selectedAgentProfile, setSelectedAgentProfile]);

  const tabs = activeAgentProfile ? SINGLE_AGENT_TABS : ALL_AGENT_TABS;
  const requestedTab = searchParams.get("tab") as AgentsTab | null;
  const activeTab: AgentsTab =
    requestedTab && tabs.includes(requestedTab) ? requestedTab : tabs[0];

  function selectTab(tab: AgentsTab) {
    setSearchParams({ tab }, { replace: true });
  }

  function selectAgent(profile: string) {
    setSelectedAgentProfile(profile);
    setSearchParams({ tab: "overview" }, { replace: true });
  }

  const scopeLabel = activeAgentProfile
    ? (selectedAgent?.name ?? activeAgentProfile)
    : t("nav.allAgents");

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text)]">
              {t("agents.title")}
            </h1>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
              {activeAgentProfile
                ? t("agents.scope.agent")
                : t("agents.scope.all")}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{t("agents.scope.label")}</span>
            <code className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[var(--text)]">
              {scopeLabel}
            </code>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <nav className="w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            {tabs.map((tab) => (
              <TabButton
                key={tab}
                active={activeTab === tab}
                onClick={() => selectTab(tab)}
                icon={TAB_ICONS[tab]}
                label={t(`agents.tabs.${tab}`)}
              />
            ))}
          </nav>

          <main className="flex-1 overflow-y-auto p-6">
            {!activeAgentProfile ? (
              activeTab === "overview" ? (
                <AllAgentsOverviewTab agents={agents} />
              ) : activeTab === "agents" ? (
                <AllAgentsTab agents={agents} onSelectAgent={selectAgent} />
              ) : activeTab === "sessions" ? (
                <NativeSessionsTab profile={null} agents={agents} />
              ) : (
                <CronTab instanceId={null} profile={null} />
              )
            ) : activeTab === "overview" ? (
              <AgentOverviewTab
                agent={selectedAgent}
                profile={activeAgentProfile}
              />
            ) : activeTab === "sessions" ? (
              <NativeSessionsTab
                profile={activeAgentProfile}
                agents={agents}
              />
            ) : activeTab === "prompt" ? (
              <PromptTab profile={activeAgentProfile} />
            ) : (
              <CronTab instanceId={null} profile={activeAgentProfile} />
            )}
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
