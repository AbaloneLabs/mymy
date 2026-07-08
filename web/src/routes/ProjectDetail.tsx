import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import { useCalendarEvents } from "@/features/calendar/api";
import { useChatSessions } from "@/features/chat/api";
import { useNotes } from "@/features/notes/api";
import {
  ProjectActivityWidgets,
  type ProjectAgentDisplay,
} from "@/features/projects/components/ProjectActivityWidgets";
import { ProjectDetailHeader } from "@/features/projects/components/ProjectDetailHeader";
import { ProjectOverviewCard } from "@/features/projects/components/ProjectOverviewCard";
import { useProject } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setSelectedProjectId } = useProjectContext();

  const { data, isLoading, isError } = useProject(id);
  const project = data?.project;

  const { data: sessionsData } = useChatSessions(id);
  const sessions = (sessionsData?.sessions ?? []).slice(0, 5);

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

  const { data: notesData } = useNotes(id);
  const recentNotes = (notesData?.notes ?? []).slice(0, 5);

  const { data: agentsData } = useAgents();
  const agentMap = useMemo(() => {
    const agents = new Map<string, ProjectAgentDisplay>();
    for (const agent of agentsData?.agents ?? []) {
      agents.set(agent.profile, { name: agent.name, role: agent.role });
    }
    return agents;
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
        <ProjectDetailHeader project={project} />
        <ProjectOverviewCard project={project} />
        <ProjectActivityWidgets
          sessions={sessions}
          events={upcomingEvents}
          notes={recentNotes}
          agentMap={agentMap}
          onChat={handleChatAboutProject}
          onCalendar={handleViewCalendar}
          onNotes={handleViewNotes}
        />
      </div>
    </AppLayout>
  );
}
