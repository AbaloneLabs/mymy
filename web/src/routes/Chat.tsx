import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  FolderGit2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AppLayout } from "@/components/AppLayout";
import { ChatPanel } from "@/components/ChatPanel";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { DocumentEditorPane } from "@/features/documentEditor/DocumentEditorPane";
import {
  LightweightBrowserPane,
  type LightweightBrowserSource,
} from "@/features/drive/components/LightweightBrowserPane";
import { useCreateAction } from "@/hooks/useGlobalShortcuts";
import { useAgents } from "@/features/agents/api";
import { useChatSessions, useCreateChatSession, useDeleteChatSession } from "@/features/chat/api";
import { useChatSessionSelection } from "@/features/chat/useChatSessionSelection";
import { useProjects } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";
import type { ChatSession } from "@/types/chat";


export default function Chat() {
  const { t } = useTranslation();

  // Project + agent context from TopBar dropdowns.
  const {
    selectedProjectId,
    selectedAgentProfile,
    setSelectedAgentProfile,
  } = useProjectContext();
  const isAllMode = selectedProjectId === null;

  // Agents lookup (profile -> agent) for display and scope validation.
  const { data: agentsData } = useAgents();
  const agents = useMemo(() => agentsData?.agents ?? [], [agentsData]);
  const activeAgentProfile =
    selectedAgentProfile && agents.some((agent) => agent.profile === selectedAgentProfile)
      ? selectedAgentProfile
      : undefined;

  // Sessions filtered by selected project (null = all) and agent profile (null = all).
  const { data, isLoading } = useChatSessions(
    selectedProjectId ?? undefined,
    activeAgentProfile,
  );
  const sessions: ChatSession[] = data?.sessions ?? [];

  const agentMap = useMemo(() => {
    const m = new Map<string, { name: string; role: string }>();
    for (const a of agents) {
      m.set(a.profile, { name: a.name, role: a.role });
    }
    return m;
  }, [agents]);

  // Projects lookup map (id -> name) for badge display (ALL mode only).
  const { data: projectsData } = useProjects();
  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projectsData?.projects ?? []) {
      m.set(p.id, p.name);
    }
    return m;
  }, [projectsData]);

  const {
    effectiveSessionId,
    effectiveSession,
    isNewSession,
    sessionsCollapsed,
    selectSession,
    markCreatedSession,
    markDeletedSession,
    toggleSessionsCollapsed,
  } = useChatSessionSelection(sessions);

  // New session dialog state.
  const [showDialog, setShowDialog] = useState(false);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [previewSource, setPreviewSource] =
    useState<LightweightBrowserSource | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession(selectedProjectId ?? undefined);

  const handleSelectSession = (sid: string) => {
    selectSession(sid);
  };

  const handleCreate = (vars: { profile: string; projectId?: string }) => {
    createSession.mutate(vars, {
      onSuccess: (res) => {
        markCreatedSession(res.session.id);
        setShowDialog(false);
      },
    });
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (window.confirm(t("chat.deleteConfirm"))) {
      deleteSession.mutate(sessionId);
      markDeletedSession(sessionId);
    }
  };

  const openDocumentEditor = (path: string) => {
    if (editorDirty && !window.confirm(t("documentEditor.discardConfirm"))) {
      return;
    }
    setEditorPath(path);
    setPreviewSource(null);
    setEditorDirty(false);
  };

  const openPreviewPanel = (source: LightweightBrowserSource) => {
    if (editorDirty && !window.confirm(t("documentEditor.discardConfirm"))) {
      return;
    }
    setEditorPath(null);
    setPreviewSource(source);
    setEditorDirty(false);
  };

  const closeSidePanel = () => {
    if (editorDirty && !window.confirm(t("documentEditor.discardConfirm"))) {
      return;
    }
    setEditorPath(null);
    setPreviewSource(null);
    setEditorDirty(false);
  };

  const sidePanelOpen = Boolean(editorPath || previewSource);

  // Keyboard shortcut: press C on the chat page to open the new-session dialog.
  const createNonce = useCreateAction("create.chat");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (createNonce > 0) setShowDialog(true);
  }, [createNonce]);

  useEffect(() => {
    if (
      selectedAgentProfile &&
      agentsData &&
      !agents.some((agent) => agent.profile === selectedAgentProfile)
    ) {
      setSelectedAgentProfile(null);
    }
  }, [agents, agentsData, selectedAgentProfile, setSelectedAgentProfile]);

  return (
    <AppLayout>
      <div className="flex h-full">
        {/* Session list sidebar */}
        <div
          className={cn(
            "flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] transition-[width] duration-150",
            sessionsCollapsed ? "w-[68px]" : "w-72",
          )}
        >
          {/* Header */}
          <div className={cn("flex items-center justify-between py-3", sessionsCollapsed ? "px-2" : "px-4")}>
            <span className={cn("text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]", sessionsCollapsed && "sr-only")}>
              {t("chat.sessions")}
            </span>
            <button
              type="button"
              onClick={toggleSessionsCollapsed}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              title={sessionsCollapsed ? "세션 목록 펼치기" : "세션 목록 접기"}
            >
              {sessionsCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
              )}
            </button>
          </div>

          {/* New session button */}
          <div className={cn("pb-2", sessionsCollapsed ? "px-2" : "px-3")}>
            <button
              type="button"
              onClick={() => setShowDialog(true)}
              title={t("chat.newSession")}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150",
                sessionsCollapsed && "justify-center px-0",
                "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className={cn(sessionsCollapsed && "hidden")}>
                {t("chat.newSession")}
              </span>
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
                  title={session.title || t("chat.newSession")}
                  onClick={() => handleSelectSession(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectSession(session.id);
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150",
                    sessionsCollapsed && "justify-center px-0",
                    isActive
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  )}
                >
                  {/* Agent initial avatar */}
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-[9px] font-semibold text-white">
                    {initial}
                  </div>
                  <div className={cn("min-w-0 flex-1", sessionsCollapsed && "hidden")}>
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
                      sessionsCollapsed && "hidden",
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

        {/* Chat panel with optional document editor */}
        <div
          className={cn(
            "grid min-w-0 flex-1 overflow-hidden",
            sidePanelOpen
              ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]"
              : "grid-cols-1",
          )}
        >
          <div className="min-w-0 overflow-hidden">
            <ChatPanel
              sessionId={effectiveSessionId}
              isNewSession={isNewSession}
              agentName={
                effectiveSession
                  ? agentMap.get(effectiveSession.profile)?.name ??
                    effectiveSession.profile
                  : undefined
              }
              agentRole={
                effectiveSession
                  ? agentMap.get(effectiveSession.profile)?.role
                  : undefined
              }
              onOpenDocument={openDocumentEditor}
              onOpenPreview={openPreviewPanel}
            />
          </div>
          {sidePanelOpen && (
            <div className="fixed inset-0 z-40 bg-[var(--bg)] xl:static xl:z-auto xl:min-w-0">
              {previewSource ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-12 shrink-0 items-center justify-end border-b border-[var(--border)] px-4">
                    <button
                      type="button"
                      onClick={closeSidePanel}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      {t("common.close")}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <LightweightBrowserPane source={previewSource} />
                  </div>
                </div>
              ) : editorPath && isHtmlPreviewPath(editorPath) ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-12 shrink-0 items-center justify-end border-b border-[var(--border)] px-4">
                    <button
                      type="button"
                      onClick={closeSidePanel}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      {t("common.close")}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <LightweightBrowserPane path={editorPath} />
                  </div>
                </div>
              ) : editorPath ? (
                <DocumentEditorPane
                  path={editorPath}
                  onClose={closeSidePanel}
                  onDirtyChange={setEditorDirty}
                />
              ) : null}
            </div>
          )}
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

function isHtmlPreviewPath(path: string) {
  return /\.html?$/i.test(path);
}
