import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, Bot, ChevronDown, Check } from "lucide-react";
import { useProjects } from "@/features/projects/api";
import { useAgents } from "@/features/agents/api";
import { useProjectContext } from "@/store/projectContext";
import { OmniSearch } from "@/components/OmniSearch";
import { cn } from "@/lib/utils";

/**
 * Global TopBar — shown on all pages except Home (`/`).
 *
 * Left side: project dropdown + agent dropdown (side by side).
 * Selecting a project/agent sets the global context ONLY — it never
 * navigates. This keeps the user on the current page (Chat, Calendar,
 * Tasks, ...) while filtering that page's data by the chosen context.
 *
 * Navigation to a specific project's dashboard happens via explicit
 * entry points (e.g. clicking a project card on Home).
 */
export function TopBar() {
  const { t } = useTranslation();
  const { data: projectsData } = useProjects();
  const { data: agentsData } = useAgents();
  const {
    selectedProjectId,
    setSelectedProjectId,
    selectedAgentProfile,
    setSelectedAgentProfile,
  } = useProjectContext();

  const [projectOpen, setProjectOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const projects = projectsData?.projects ?? [];
  const activeProjects = projects.filter((p) => p.status === "active");
  const agents = agentsData?.agents ?? [];

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const projectLabel = selectedProject ? selectedProject.name : t("chat.allProjects");

  const selectedAgent = agents.find(
    (a) => a.id.replace(/^hermes-/, "") === selectedAgentProfile,
  );
  const agentLabel = selectedAgent ? selectedAgent.name : t("nav.allAgents");

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setProjectOpen(false);
        setAgentOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelectProject(id: string | null) {
    setSelectedProjectId(id);
    setProjectOpen(false);
  }

  function handleSelectAgent(profile: string | null) {
    setSelectedAgentProfile(profile);
    setAgentOpen(false);
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3" ref={containerRef}>
        {/* Project dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setProjectOpen((v) => !v);
              setAgentOpen(false);
            }}
            disabled={activeProjects.length === 0}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
              activeProjects.length === 0
                ? "cursor-not-allowed text-[var(--text-faint)] opacity-60"
                : "text-[var(--text)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <FolderGit2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>{projectLabel}</span>
            {activeProjects.length > 0 && (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150",
                  projectOpen && "rotate-180",
                )}
                strokeWidth={1.5}
              />
            )}
          </button>

          {projectOpen && activeProjects.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
              {/* All Projects */}
              <button
                type="button"
                onClick={() => handleSelectProject(null)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150",
                  selectedProjectId === null
                    ? "bg-[var(--surface-hover)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                )}
              >
                <FolderGit2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1">{t("chat.allProjects")}</span>
                {selectedProjectId === null && (
                  <Check className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={2} />
                )}
              </button>

              {/* Divider */}
              <div className="h-px bg-[var(--border)]" />

              {/* Individual projects */}
              {activeProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProject(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150",
                    selectedProjectId === p.id
                      ? "bg-[var(--surface-hover)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  )}
                >
                  <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
                  <span className="flex-1 truncate">{p.name}</span>
                  {selectedProjectId === p.id && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Agent dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAgentOpen((v) => !v);
              setProjectOpen(false);
            }}
            disabled={agents.length === 0}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150",
              agents.length === 0
                ? "cursor-not-allowed text-[var(--text-faint)] opacity-60"
                : "text-[var(--text)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <Bot className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>{agentLabel}</span>
            {agents.length > 0 && (
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150",
                  agentOpen && "rotate-180",
                )}
                strokeWidth={1.5}
              />
            )}
          </button>

          {agentOpen && agents.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
              {/* All Agents */}
              <button
                type="button"
                onClick={() => handleSelectAgent(null)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150",
                  selectedAgentProfile === null
                    ? "bg-[var(--surface-hover)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                )}
              >
                <Bot className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1">{t("nav.allAgents")}</span>
                {selectedAgentProfile === null && (
                  <Check className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={2} />
                )}
              </button>

              {/* Divider */}
              <div className="h-px bg-[var(--border)]" />

              {/* Individual agents */}
              {agents.map((a) => {
                const profile = a.id.replace(/^hermes-/, "");
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => handleSelectAgent(profile)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150",
                      selectedAgentProfile === profile
                        ? "bg-[var(--surface-hover)] text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-[10px] font-semibold text-white">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate">{a.name}</span>
                    {selectedAgentProfile === profile && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* OmniSearch — placed to the right of the project/agent filters */}
      <OmniSearch />

      {activeProjects.length === 0 && agents.length === 0 && (
        <span className="ml-3 text-xs text-[var(--text-faint)]">
          {t("chat.noProjectsHint")}
        </span>
      )}
    </header>
  );
}
