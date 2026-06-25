import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useChatSessions, useDeleteChatSession } from "@/features/chat/api";
import type { ChatSession } from "@/types/chat";

interface SessionSidebarProps {
  projectId: string;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  /** Called when the "new session" button is clicked (opens the dialog in parent). */
  onNewSessionClick: () => void;
}


export function SessionSidebar({
  projectId,
  activeSessionId,
  onSelectSession,
  onNewSessionClick,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useChatSessions(projectId);
  const deleteSession = useDeleteChatSession(projectId);

  const sessions: ChatSession[] = data?.sessions ?? [];

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (window.confirm(t("chat.deleteConfirm"))) {
      deleteSession.mutate(sessionId);
    }
  };

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
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
          onClick={onNewSessionClick}
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
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <div className="px-2 py-4 text-center">
            <span className="text-xs text-[var(--text-faint)]">{t("chat.noSessions")}</span>
          </div>
        )}

        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSession(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectSession(session.id);
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150",
                isActive
                  ? "bg-[var(--surface-hover)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate text-xs">
                {session.title || t("chat.newSession")}
              </span>
              <button
                type="button"
                onClick={(e) => handleDelete(e, session.id)}
                disabled={deleteSession.isPending}
                className={cn(
                  "shrink-0 opacity-0 transition-opacity duration-150",
                  "text-[var(--text-faint)] hover:text-[var(--status-error)]",
                  "group-hover:opacity-100"
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
  );
}
