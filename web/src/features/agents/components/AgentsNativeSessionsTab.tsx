import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useChatSessions } from "@/features/chat/api";
import { useProjectContext } from "@/store/projectContext";
import type { Agent } from "@/types/agents";
import {
  EmptyState,
  PanelError,
  PanelLoading,
} from "./AgentsNativeShared";
import { formatDate, profileFromAgent } from "./AgentsNativeUtils";

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
