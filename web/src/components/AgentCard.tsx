import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/agents";
import { AgentAvatar } from "./AgentAvatar";
import { StatusDot } from "./StatusDot";

interface AgentCardProps {
  agent: Agent;
  onOpenSettings?: (agent: Agent) => void;
  className?: string;
}


export function AgentCard({ agent, onOpenSettings, className }: AgentCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3",
        "transition-colors duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]",
        className
      )}
    >
      <AgentAvatar agent={agent} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--text)]">{agent.name}</span>
          <StatusDot status={agent.status} />
        </div>
        <p className="truncate text-xs text-[var(--text-muted)]">{agent.role}</p>
      </div>

      <button
        type="button"
        onClick={() => onOpenSettings?.(agent)}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          "text-[var(--text-muted)] opacity-0 transition-opacity duration-150",
          "hover:bg-[var(--surface-active)] hover:text-[var(--text)]",
          "group-hover:opacity-100 focus:opacity-100"
        )}
        aria-label={t("agent.settings", { name: agent.name })}
      >
        <Settings className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
