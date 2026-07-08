import {
  Calendar,
  FileText,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CalendarEvent } from "@/types/calendar";
import type { ChatSession } from "@/types/chat";
import type { Note } from "@/types/notes";
import { ProjectActionButton, ProjectWidgetCard } from "./ProjectWidgetCard";

export interface ProjectAgentDisplay {
  name: string;
  role: string;
}

export function ProjectActivityWidgets({
  sessions,
  events,
  notes,
  agentMap,
  onChat,
  onCalendar,
  onNotes,
}: {
  sessions: ChatSession[];
  events: CalendarEvent[];
  notes: Note[];
  agentMap: Map<string, ProjectAgentDisplay>;
  onChat: () => void;
  onCalendar: () => void;
  onNotes: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ProjectWidgetCard title={t("projectDetail.recentSessions")} onViewAll={onChat}>
        {sessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-faint)]">
            {t("projectDetail.noSessions")}
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((session) => {
              const agent = agentMap.get(session.profile);
              const initial = agent?.name.trim().charAt(0).toUpperCase() ?? "?";
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={onChat}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--surface-hover)]"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-[11px] font-semibold text-white">
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[var(--text)]">
                        {session.title || t("chat.newSession")}
                      </div>
                      <div className="text-[11px] text-[var(--text-faint)]">
                        {agent?.name ?? session.profile} ·{" "}
                        {t("projectDetail.messageCount", {
                          count: session.messageCount,
                        })}
                      </div>
                    </div>
                    {session.updatedAt && (
                      <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
                        {new Date(session.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ProjectWidgetCard>

      <ProjectWidgetCard
        title={t("projectDetail.upcomingEvents")}
        onViewAll={onCalendar}
      >
        {events.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-faint)]">
            {t("projectDetail.noEvents")}
          </p>
        ) : (
          <ul className="space-y-1">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={onCalendar}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <Calendar
                    className="h-4 w-4 shrink-0 text-[var(--text-dim)]"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--text)]">
                      {event.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-faint)]">
                      {new Date(event.startDate).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      {!event.allDay &&
                        ` · ${new Date(event.startDate).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ProjectWidgetCard>

      <ProjectWidgetCard title={t("projectDetail.recentNotes")} onViewAll={onNotes}>
        {notes.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-faint)]">
            {t("projectDetail.noNotes")}
          </p>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={onNotes}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <FileText
                    className="h-4 w-4 shrink-0 text-[var(--text-dim)]"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--text)]">
                      {note.title || t("notes.untitled")}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-faint)]">
                      {note.content ? note.content.slice(0, 60) : t("notes.noContent")}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ProjectWidgetCard>

      <ProjectWidgetCard title={t("projectDetail.quickActions")}>
        <div className="flex flex-col gap-1">
          <ProjectActionButton
            icon={MessageSquare}
            label={t("projectDetail.chatHere")}
            onClick={onChat}
          />
          <ProjectActionButton
            icon={Calendar}
            label={t("projectDetail.calendarHere")}
            onClick={onCalendar}
          />
          <ProjectActionButton
            icon={NotebookPen}
            label={t("projectDetail.notesHere")}
            onClick={onNotes}
          />
        </div>
      </ProjectWidgetCard>
    </div>
  );
}
