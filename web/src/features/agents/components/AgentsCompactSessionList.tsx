import { useTranslation } from "react-i18next";
import type { ChatSession } from "@/types/chat";
import { formatDate } from "./AgentsNativeUtils";

export function CompactSessionList({
  sessions,
  showProfile,
}: {
  sessions: ChatSession[];
  showProfile: boolean;
}) {
  const { t } = useTranslation();
  if (sessions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
        {t("agents.sessions.empty")}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2"
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-[var(--text)]">
              {session.title || t("chat.newSession")}
            </div>
            <div className="mt-0.5 flex gap-2 text-[11px] text-[var(--text-faint)]">
              {showProfile && <span>{session.profile}</span>}
              <span>{formatDate(session.updatedAt)}</span>
            </div>
          </div>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
            {session.messageCount}
          </span>
        </div>
      ))}
    </div>
  );
}
