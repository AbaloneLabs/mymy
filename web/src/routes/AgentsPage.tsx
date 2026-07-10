import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import {
  AgentOverviewTab,
  AllAgentsOverviewTab,
  AllAgentsTab,
  NativeSessionsTab,
  PromptTab,
  SandboxProcessesTab,
} from "@/features/agents/components/AgentsNativePanels";
import { CronTab } from "@/features/agents/components/AgentsCronTab";
import { DecisionsTab } from "@/features/agents/components/AgentsDecisionsTab";
import { MemoryTab } from "@/features/agents/components/AgentsMemoryTab";
import { TabButton } from "@/features/agents/components/AgentsNativeShared";
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
  const [tabsCollapsed, setTabsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("mymy:agents-tabs-collapsed") === "true";
  });
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

  function toggleTabsCollapsed() {
    setTabsCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("mymy:agents-tabs-collapsed", String(next));
      return next;
    });
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
          <nav
            className={
              tabsCollapsed
                ? "w-[64px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3 transition-[width] duration-150"
                : "w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3 transition-[width] duration-150"
            }
          >
            <button
              type="button"
              onClick={toggleTabsCollapsed}
              className="mb-2 flex h-8 w-full items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              title={tabsCollapsed ? "탭 목록 펼치기" : "탭 목록 접기"}
            >
              {tabsCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
            {tabs.map((tab) => (
              <TabButton
                key={tab}
                active={activeTab === tab}
                onClick={() => selectTab(tab)}
                icon={TAB_ICONS[tab]}
                label={t(`agents.tabs.${tab}`)}
                collapsed={tabsCollapsed}
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
              ) : activeTab === "decisions" ? (
                <DecisionsTab profile={null} />
              ) : activeTab === "memory" ? (
                <MemoryTab profile={null} />
              ) : (
                <div className="space-y-6">
                  <SandboxProcessesTab profile={null} agents={agents} />
                  <CronTab instanceId={null} profile={null} />
                </div>
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
            ) : activeTab === "decisions" ? (
              <DecisionsTab profile={activeAgentProfile} />
            ) : activeTab === "memory" ? (
              <MemoryTab profile={activeAgentProfile} />
            ) : (
              <div className="space-y-6">
                <SandboxProcessesTab
                  profile={activeAgentProfile}
                  agents={agents}
                />
                <CronTab instanceId={null} profile={activeAgentProfile} />
              </div>
            )}
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
