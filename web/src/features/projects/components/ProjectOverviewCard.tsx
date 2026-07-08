import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/projects";

export function ProjectOverviewCard({ project }: { project: Project }) {
  const { t } = useTranslation();
  return (
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
  );
}
