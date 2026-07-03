import { useMemo, type ReactNode } from "react";
import {
  ArrowRight,
  Calendar,
  FileText,
  FolderGit2,
  Loader2,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import { useCalendarEvents } from "@/features/calendar/api";
import { useChatSessions } from "@/features/chat/api";
import { useNotes } from "@/features/notes/api";
import { useProject } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";
import { cn } from "@/lib/utils";


export default function ProjectDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setSelectedProjectId } = useProjectContext();

  const { data, isLoading, isError } = useProject(id);
  const project = data?.project;

  // Recent sessions for this project (summary, max 5).
  const { data: sessionsData } = useChatSessions(id);
  const sessions = (sessionsData?.sessions ?? []).slice(0, 5);

  // Upcoming events for this project (from today forward, next 3 months).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date();
  rangeEnd.setMonth(rangeEnd.getMonth() + 3);
  const { data: eventsData } = useCalendarEvents(
    todayStart.toISOString(),
    rangeEnd.toISOString(),
    id,
  );
  const upcomingEvents = (eventsData?.events ?? []).slice(0, 5);

  // Recent notes for this project.
  const { data: notesData } = useNotes(id);
  const recentNotes = (notesData?.notes ?? []).slice(0, 5);

  // Agents lookup (profile -> agent) for session display.
  const { data: agentsData } = useAgents();
  const agentMap = useMemo(() => {
    const m = new Map<string, { name: string; role: string }>();
    for (const a of agentsData?.agents ?? []) {
      m.set(a.profile, { name: a.name, role: a.role });
    }
    return m;
  }, [agentsData]);

  const handleChatAboutProject = () => {
    if (id) {
      setSelectedProjectId(id);
      navigate("/chat");
    }
  };

  const handleViewCalendar = () => {
    if (id) {
      setSelectedProjectId(id);
      navigate("/calendar");
    }
  };

  const handleViewNotes = () => {
    if (id) {
      setSelectedProjectId(id);
      navigate("/notes");
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2
            className="h-5 w-5 animate-spin text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
          <span className="ml-2 text-sm text-[var(--text-muted)]">
            {t("common.loading")}
          </span>
        </div>
      </AppLayout>
    );
  }

  if (isError || !project) {
    return (
      <AppLayout>
        <div className="py-20 text-center">
          <span className="text-sm text-[var(--status-error)]">
            {t("projectDetail.notFound")}
          </span>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Project title */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-active)]">
            <FolderGit2 className="h-5 w-5 text-[var(--text-muted)]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[var(--text)]">
              {project.name}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              {project.description || t("projectDetail.noDescription")}
            </p>
          </div>
        </div>

        {/* Overview card */}
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t("projectDetail.overview")}
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--text-faint)]">
                {t("projects.gitSystem")}
              </dt>
              <dd className="mt-0.5 text-[var(--text)]">
                {project.gitSystem ? (
                  <span className="rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] uppercase">
                    {project.gitSystem}
                  </span>
                ) : (
                  <span className="text-[var(--text-faint)]">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-faint)]">
                {t("projects.status")}
              </dt>
              <dd className="mt-0.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    project.status === "active"
                      ? "text-[var(--status-active)]"
                      : "text-[var(--text-muted)]",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      project.status === "active"
                        ? "bg-[var(--status-active)]"
                        : "bg-[var(--text-faint)]",
                    )}
                  />
                  {project.status}
                </span>
              </dd>
            </div>
            {project.gitRemote && (
              <div className="col-span-2">
                <dt className="text-xs text-[var(--text-faint)]">
                  {t("projects.gitRemote")}
                </dt>
                <dd className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">
                  {project.gitRemote}
                </dd>
              </div>
            )}
            {project.createdAt && (
              <div>
                <dt className="text-xs text-[var(--text-faint)]">
                  {t("projectDetail.created")}
                </dt>
                <dd className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {new Date(project.createdAt).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Activity widgets — 2-column grid on wide screens */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Recent chat sessions */}
          <WidgetCard
            title={t("projectDetail.recentSessions")}
            onViewAll={handleChatAboutProject}
            t={t}
          >
            {sessions.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-faint)]">
                {t("projectDetail.noSessions")}
              </p>
            ) : (
              <ul className="space-y-1">
                {sessions.map((session) => {
                  const agent = agentMap.get(session.profile);
                  const initial =
                    agent?.name.trim().charAt(0).toUpperCase() ?? "?";
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        onClick={handleChatAboutProject}
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
          </WidgetCard>

          {/* Upcoming events */}
          <WidgetCard
            title={t("projectDetail.upcomingEvents")}
            onViewAll={handleViewCalendar}
            t={t}
          >
            {upcomingEvents.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-faint)]">
                {t("projectDetail.noEvents")}
              </p>
            ) : (
              <ul className="space-y-1">
                {upcomingEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={handleViewCalendar}
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
                          {new Date(event.startDate).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                          {!event.allDay &&
                            ` · ${new Date(event.startDate).toLocaleTimeString(
                              [],
                              { hour: "2-digit", minute: "2-digit" },
                            )}`}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          {/* Recent notes */}
          <WidgetCard
            title={t("projectDetail.recentNotes")}
            onViewAll={handleViewNotes}
            t={t}
          >
            {recentNotes.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--text-faint)]">
                {t("projectDetail.noNotes")}
              </p>
            ) : (
              <ul className="space-y-1">
                {recentNotes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={handleViewNotes}
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
                          {note.content
                            ? note.content.slice(0, 60)
                            : t("notes.noContent")}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          {/* Quick actions */}
          <WidgetCard title={t("projectDetail.quickActions")} t={t}>
            <div className="flex flex-col gap-1">
              <ActionButton
                icon={MessageSquare}
                label={t("projectDetail.chatHere")}
                onClick={handleChatAboutProject}
              />
              <ActionButton
                icon={Calendar}
                label={t("projectDetail.calendarHere")}
                onClick={handleViewCalendar}
              />
              <ActionButton
                icon={NotebookPen}
                label={t("projectDetail.notesHere")}
                onClick={handleViewNotes}
              />
            </div>
          </WidgetCard>
        </div>
      </div>
    </AppLayout>
  );
}

/**
 * Widget card container with optional "View all" header link.
 * Same surface/border styling as the overview card.
 */
function WidgetCard({
  title,
  onViewAll,
  t,
  children,
}: {
  title: string;
  onViewAll?: () => void;
  t: (key: string) => string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="flex items-center gap-1 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            {t("projectDetail.viewAll")}
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Full-width action button used in the Quick Actions widget.
 */
function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)]"
    >
      <Icon
        className="h-4 w-4 text-[var(--text-muted)]"
        strokeWidth={1.5}
      />
      <span>{label}</span>
      <ArrowRight
        className="ml-auto h-3.5 w-3.5 text-[var(--text-faint)]"
        strokeWidth={1.5}
      />
    </button>
  );
}
