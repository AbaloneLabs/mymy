import { FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Project } from "@/types/projects";

export function ProjectDetailHeader({ project }: { project: Project }) {
  const { t } = useTranslation();
  return (
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
  );
}
