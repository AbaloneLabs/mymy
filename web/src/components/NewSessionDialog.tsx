import { useState } from "react";
import { X, Loader2, FolderGit2, Check, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useAgents } from "@/features/agents/api";
import { useProjects } from "@/features/projects/api";
import type { Agent } from "@/types/agents";

interface NewSessionDialogProps {
  /** Pre-selected project ID (e.g. from ProjectDetail). If set, hides project picker. */
  projectId?: string;
  onClose: () => void;
  onCreate: (vars: { profile: string; projectId?: string }) => void;
  isPending: boolean;
}


export function NewSessionDialog({
  projectId,
  onClose,
  onCreate,
  isPending,
}: NewSessionDialogProps) {
  const { t } = useTranslation();
  const { data: agentsData } = useAgents();
  const { data: projectsData } = useProjects();

  const agents = agentsData?.agents ?? [];
  const projects = (projectsData?.projects ?? []).filter(
    (p) => p.status === "active",
  );

  // Default selected agent: first discovered agent.
  const [selectedProfile, setSelectedProfile] = useState<string>(
    agents.length > 0 ? agents[0].id.replace(/^hermes-/, "") : "default",
  );
  // Default selected project: the pre-selected one, or none (General).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projectId ?? null,
  );

  const handleCreate = () => {
    onCreate({
      profile: selectedProfile,
      projectId: selectedProjectId ?? undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {t("chat.newSession")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label={t("common.cancel")}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Step 1: Agent selection */}
          <div className="mb-1 mt-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("chat.selectAgent")}
            </span>
          </div>
          <div className="mb-4 space-y-0.5">
            {agents.length === 0 && (
              <p className="py-3 text-center text-xs text-[var(--text-faint)]">
                {t("chat.noAgents")}
              </p>
            )}
            {agents.map((agent) => (
              <AgentOption
                key={agent.id}
                agent={agent}
                selected={selectedProfile === agent.id.replace(/^hermes-/, "")}
                onSelect={() =>
                  setSelectedProfile(agent.id.replace(/^hermes-/, ""))
                }
              />
            ))}
          </div>

          {/* Step 2: Project selection (hidden if projectId is pre-set) */}
          {!projectId && (
            <>
              <div className="mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("chat.selectProject")}
                </span>
              </div>
              <div className="space-y-0.5">
                {/* General (no project) */}
                <ProjectOption
                  label={t("chat.general")}
                  description={t("chat.generalDesc")}
                  selected={selectedProjectId === null}
                  onSelect={() => setSelectedProjectId(null)}
                  isGeneral
                />
                {projects.map((project) => (
                  <ProjectOption
                    key={project.id}
                    label={project.name}
                    description={project.description}
                    selected={selectedProjectId === project.id}
                    onSelect={() => setSelectedProjectId(project.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            )}
            {t("chat.startSession")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Agent selection row. */
function AgentOption({
  agent,
  selected,
  onSelect,
}: {
  agent: Pick<Agent, "id" | "name" | "role" | "status">;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150",
        selected
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      <AgentAvatar
        agent={{ name: agent.name, avatarUrl: undefined }}
        size="sm"
        className="h-7 w-7 text-xs"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{agent.name}</div>
        <div className="truncate text-[11px] text-[var(--text-faint)]">
          {agent.role}
        </div>
      </div>
      {selected && (
        <Check
          className="h-4 w-4 shrink-0 text-[var(--accent)]"
          strokeWidth={2}
        />
      )}
    </button>
  );
}

/** Project selection row. */
function ProjectOption({
  label,
  description,
  selected,
  onSelect,
  isGeneral = false,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  isGeneral?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150",
        selected
          ? "bg-[var(--surface-hover)] text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-active)]">
        {isGeneral ? (
          <Sparkles
            className="h-3.5 w-3.5 text-[var(--accent)]"
            strokeWidth={1.5}
          />
        ) : (
          <FolderGit2
            className="h-3.5 w-3.5 text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        {description && (
          <div className="truncate text-[11px] text-[var(--text-faint)]">
            {description}
          </div>
        )}
      </div>
      {selected && (
        <Check
          className="h-4 w-4 shrink-0 text-[var(--accent)]"
          strokeWidth={2}
        />
      )}
    </button>
  );
}
