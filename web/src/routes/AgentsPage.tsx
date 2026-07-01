import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { useAgentSystems } from "@/features/agent-systems/api";
import {
  CronTab,
  EnvironmentTab,
  IdentityTab,
  MemoryTab,
  OverviewTab,
  SessionsTab,
  SkillsTab,
  TabButton,
} from "@/features/agents/components/AgentsPanels";
import {
  TAB_ICONS,
  VALID_TABS,
  type AgentsTab,
} from "@/features/agents/components/agentsTabs";
import { useProjectContext } from "@/store/projectContext";

/**
 * Agents page — read-only Hermes operational data viewer.
 *
 * Surfaces gateway status, cron jobs, sessions, skills, memory, identity,
 * and environment by querying the Hermes CLI via the backend. Hermes is the
 * source of truth; mymy only displays the data.
 *
 * The active profile is driven by the TopBar agent filter
 * (projectContext.selectedAgentProfile). The local Hermes instance is
 * auto-selected.
 *
 * Layout (3 columns): [main sidebar] | [agents tabs] | [content panel]
 * The active tab is stored in URL search param `?tab=`.
 */

export default function AgentsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAgentProfile = useProjectContext(
    (s) => s.selectedAgentProfile,
  );

  // Read active tab from URL, default to "overview".
  const rawTab = searchParams.get("tab");
  const activeTab: AgentsTab = (
    rawTab && VALID_TABS.includes(rawTab as AgentsTab) ? rawTab : "overview"
  ) as AgentsTab;

  function selectTab(tab: AgentsTab) {
    setSearchParams(
      (prev) => {
        prev.set("tab", tab);
        return prev;
      },
      { replace: true },
    );
  }

  // Fetch agent system instances — auto-select the first enabled local one.
  const { data: systemsData } = useAgentSystems();
  const instances = useMemo(
    () => systemsData?.instances ?? [],
    [systemsData],
  );
  const instanceId = useMemo(
    () =>
      instances.find((i) => i.enabled && i.connection === "local")?.id ?? null,
    [instances],
  );

  // The profile comes from the TopBar agent filter. Default to "default"
  // when "All Agents" (null) is selected so the page always shows data.
  const profile = selectedAgentProfile ?? "default";

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">
            {t("agents.title")}
          </h1>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{t("agents.profile")}</span>
            <code className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[var(--text)]">
              {profile}
            </code>
          </div>
        </header>

        {/* Body: tab sidebar + content panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left tab sidebar */}
          <nav className="w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            {VALID_TABS.map((tab) => (
              <TabButton
                key={tab}
                active={activeTab === tab}
                onClick={() => selectTab(tab)}
                icon={TAB_ICONS[tab]}
                label={t(`agents.tabs.${tab}`)}
              />
            ))}
          </nav>

          {/* Content panel */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "cron" ? (
              <CronTab instanceId={instanceId} profile={profile} />
            ) : !instanceId ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                {t("agents.noInstances")}
              </div>
            ) : activeTab === "overview" ? (
              <OverviewTab instanceId={instanceId} profile={profile} />
            ) : activeTab === "sessions" ? (
              <SessionsTab instanceId={instanceId} profile={profile} />
            ) : activeTab === "skills" ? (
              <SkillsTab instanceId={instanceId} profile={profile} />
            ) : activeTab === "memory" ? (
              <MemoryTab instanceId={instanceId} profile={profile} />
            ) : activeTab === "identity" ? (
              <IdentityTab instanceId={instanceId} profile={profile} />
            ) : (
              <EnvironmentTab instanceId={instanceId} profile={profile} />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
