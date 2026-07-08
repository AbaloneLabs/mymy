import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Trash2 } from "lucide-react";
import { useDeleteAgent } from "@/features/agents/api";
import { useChatSessions } from "@/features/chat/api";
import { useProjectContext } from "@/store/projectContext";
import type { Agent } from "@/types/agents";
import { CreateAgentPanel } from "./AgentsCreateAgentPanel";
import {
  AgentAvatar,
  AgentStatusDot,
  EmptyState,
  Metric,
} from "./AgentsNativeShared";
import { profileFromAgent } from "./AgentsNativeUtils";

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
