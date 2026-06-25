import { Trash2, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDeleteProject } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";
import type { Project } from "@/types/projects";

interface ProjectCardProps {
  project: Project;
  className?: string;
}


export function ProjectCard({ project, className }: ProjectCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deleteMutation = useDeleteProject();
  const setSelectedProjectId = useProjectContext((s) => s.setSelectedProjectId);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t("projects.deleteConfirm"))) {
      deleteMutation.mutate(project.id);
    }
  };

  const go = () => {
    setSelectedProjectId(project.id);
    navigate(`/projects/${project.id}`);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3",
        "transition-colors duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]",
        className
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-active)]">
        <FolderGit2 className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--text)]">{project.name}</span>
          {project.status === "archived" && (
            <span className="rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">
              {t("projects.archived")}
            </span>
          )}
        </div>
        {project.description && (
          <p className="truncate text-xs text-[var(--text-muted)]">{project.description}</p>
        )}
        {project.gitSystem && (
          <span className="mt-0.5 inline-block rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">
            {project.gitSystem}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteMutation.isPending}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          "text-[var(--text-muted)] opacity-0 transition-opacity duration-150",
          "hover:bg-[var(--status-error)] hover:text-white",
          "group-hover:opacity-100 focus:opacity-100",
          "disabled:cursor-not-allowed"
        )}
        aria-label={t("common.delete")}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
