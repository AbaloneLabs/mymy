import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AppLayout } from "@/components/AppLayout";
import { ChatPanel } from "@/components/ChatPanel";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { useCreateAction } from "@/hooks/useGlobalShortcuts";
import { useAgents } from "@/features/agents/api";
import { useChatSessions, useCreateChatSession, useDeleteChatSession } from "@/features/chat/api";
import { useProjects } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";
import type { ChatSession } from "@/types/chat";


export default function Chat() {
  const { t } = useTranslation();

  // Project + agent context from TopBar dropdowns.
  const { selectedProjectId, selectedAgentProfile } = useProjectContext();
  const isAllMode = selectedProjectId === null;

  // Sessions filtered by selected project (null = all) and agent profile (null = all).
  const { data, isLoading } = useChatSessions(
    selectedProjectId ?? undefined,
    selectedAgentProfile ?? undefined,
  );
  const sessions: ChatSession[] = data?.sessions ?? [];

  // Agents lookup (profile -> agent) for display.
  const { data: agentsData } = useAgents();
  const agentMap = useMemo(() => {
    const m = new Map<string, { name: string; role: string }>();
    for (const a of agentsData?.agents ?? []) {
      const profile = a.id.replace(/^hermes-/, "");
      m.set(profile, { name: a.name, role: a.role });
    }
    m.set("default", { name: "Default", role: t("chat.defaultAgent") });
    return m;
  }, [agentsData, t]);

  // Projects lookup map (id -> name) for badge display (ALL mode only).
  const { data: projectsData } = useProjects();
  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projectsData?.projects ?? []) {
      m.set(p.id, p.name);
    }
    return m;
  }, [projectsData]);

  // Active session state.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isNewSession, setIsNewSession] = useState(false);

  // Auto-select the most recent session if none is active.
  const effectiveSessionId =
    activeSessionId ?? (sessions.length > 0 ? sessions[0].id : null);
  const effectiveSession = sessions.find((s) => s.id === effectiveSessionId);

  // New session dialog state.
  const [showDialog, setShowDialog] = useState(false);
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession(selectedProjectId ?? undefined);

  const handleSelectSession = (sid: string) => {
    setActiveSessionId(sid);
    setIsNewSession(false);
  };

  const handleCreate = (vars: { profile: string; projectId?: string }) => {
    createSession.mutate(vars, {
      onSuccess: (res) => {
        setActiveSessionId(res.session.id);
        setIsNewSession(true);
        setShowDialog(false);
      },
    });
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (window.confirm(t("chat.deleteConfirm"))) {
      deleteSession.mutate(sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setIsNewSession(false);
      }
    }
  };

  // Keyboard shortcut: press C on the chat page to open the new-session dialog.
  const createNonce = useCreateAction("create.chat");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (createNonce > 0) setShowDialog(true);
  }, [createNonce]);

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* Session list sidebar */}
        <div className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("chat.sessions")}
            </span>
          </div>

          {/* New session button */}
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => setShowDialog(true)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150",
                "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("chat.newSession")}
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2
                  className="h-4 w-4 animate-spin text-[var(--text-muted)]"
                  strokeWidth={1.75}
                />
              </div>
            )}

            {!isLoading && sessions.length === 0 && (
              <div className="px-2 py-4 text-center">
                <span className="text-xs text-[var(--text-faint)]">
                  {t("chat.noSessions")}
                </span>
              </div>
            )}

            {sessions.map((session) => {
              const isActive = session.id === effectiveSessionId;
              // Show project badge only in ALL mode.
              const projectName =
                isAllMode && session.projectId
                  ? projectMap.get(session.projectId)
                  : undefined;
              const agent = agentMap.get(session.profile);
              const initial =
                agent?.name.trim().charAt(0).toUpperCase() ?? "?";
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectSession(session.id);
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150",
                    isActive
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  )}
                >
                  {/* Agent initial avatar */}
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-[9px] font-semibold text-white">
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs">
                      {session.title || t("chat.newSession")}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      {projectName ? (
                        <>
                          <FolderGit2
                            className="h-2.5 w-2.5 shrink-0 text-[var(--text-faint)]"
                            strokeWidth={1.75}
                          />
                          <span className="truncate text-[10px] text-[var(--text-faint)]">
                            {projectName}
                          </span>
                        </>
                      ) : isAllMode ? (
                        <span className="truncate text-[10px] text-[var(--text-faint)]">
                          {t("chat.general")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, session.id)}
                    disabled={deleteSession.isPending}
                    className={cn(
                      "shrink-0 opacity-0 transition-opacity duration-150",
                      "text-[var(--text-faint)] hover:text-[var(--status-error)]",
                      "group-hover:opacity-100",
                    )}
                    aria-label={t("chat.deleteSession")}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat panel with context header */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel
            sessionId={effectiveSessionId}
            isNewSession={isNewSession}
            agentName={effectiveSession ? agentMap.get(effectiveSession.profile)?.name : undefined}
            agentRole={effectiveSession ? agentMap.get(effectiveSession.profile)?.role : undefined}
          />
        </div>
      </div>

      {/* New session dialog — pre-select project from TopBar context */}
      {showDialog && (
        <NewSessionDialog
          onClose={() => setShowDialog(false)}
          onCreate={handleCreate}
          isPending={createSession.isPending}
          projectId={selectedProjectId ?? undefined}
        />
      )}
    </AppLayout>
  );
}
