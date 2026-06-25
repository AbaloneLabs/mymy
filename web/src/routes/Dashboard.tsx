import { useState } from "react";
import { Plus, FolderGit2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { AgentCard } from "@/components/AgentCard";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectAddForm } from "@/components/ProjectAddForm";
import { useAgents } from "@/features/agents/api";
import { useProjects } from "@/features/projects/api";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/agents";
import type { Project } from "@/types/projects";


export default function Dashboard() {
  const { t } = useTranslation();
  const { data: agentsData, isLoading: agentsLoading, isError: agentsError } = useAgents();
  const { data: projectsData, isLoading: projectsLoading, isError: projectsError } = useProjects();
  const [showAddForm, setShowAddForm] = useState(false);

  const agents: Agent[] = agentsData?.agents ?? [];
  const projects: Project[] = projectsData?.projects ?? [];

  return (
    <AppLayout>
      <main className="mx-auto max-w-6xl px-6 py-6">

        <header className="mb-6">
          <h1 className="text-lg font-semibold text-[var(--text)]">{t("dashboard.home")}</h1>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          <section>
            <SectionHeader title={t("dashboard.agents")} count={agents.length} />
            <div className="space-y-2">
              {agentsLoading && <LoadingState />}
              {agentsError && <ErrorState label="Failed to load agents. Is the API running?" />}
              {!agentsLoading && !agentsError && agents.length === 0 && (
                <EmptyState label={t("dashboard.noAgents")} />
              )}
              {!agentsLoading &&
                !agentsError &&
                agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
            </div>
          </section>


          <section>
            <SectionHeader
              title={t("dashboard.projects")}
              count={projects.length}
              actionLabel={t("dashboard.addProject")}
              onAction={() => setShowAddForm((v) => !v)}
              actionActive={showAddForm}
            />
            <div className="space-y-2">
              {showAddForm && <ProjectAddForm onClose={() => setShowAddForm(false)} />}
              {projectsLoading && <LoadingState />}
              {projectsError && <ErrorState label="Failed to load projects." />}
              {!projectsLoading &&
                !projectsError &&
                projects.length === 0 &&
                !showAddForm && <EmptyState label={t("dashboard.noProjects")} />}
              {!projectsLoading &&
                !projectsError &&
                projects.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          </section>
        </div>
      </main>
    </AppLayout>
  );
}

function SectionHeader({
  title,
  count,
  actionLabel,
  onAction,
  actionActive,
}: {
  title: string;
  count: number;
  actionLabel?: string;
  onAction?: () => void;
  actionActive?: boolean;
}) {
  // Agents section has no add action (agents are discovered, not added manually).
  const hasAction = Boolean(actionLabel && onAction);
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        <span className="text-xs text-[var(--text-muted)]">{count}</span>
      </div>
      {hasAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-150",
            actionActive
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
      <FolderGit2 className="h-6 w-6 text-[var(--text-faint)]" strokeWidth={1.5} />
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] p-8 text-center">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
      <span className="text-xs text-[var(--text-muted)]">{t("common.loading")}</span>
    </div>
  );
}

function ErrorState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--status-error)] p-8 text-center">
      <span className="text-xs text-[var(--status-error)]">{label}</span>
    </div>
  );
}
