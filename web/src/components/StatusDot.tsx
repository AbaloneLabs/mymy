import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/types/agents";

const STATUS_DOT_CLS: Record<AgentStatus, string> = {
  active: "bg-[var(--status-active)]",
  idle: "bg-[var(--status-idle)]",
  offline: "bg-[var(--text-muted)]",
};

const STATUS_KEY: Record<AgentStatus, string> = {
  active: "status.active",
  idle: "status.idle",
  offline: "status.offline",
};

interface StatusDotProps {
  status: AgentStatus;
  showLabel?: boolean;
  className?: string;
}


export function StatusDot({ status, showLabel = true, className }: StatusDotProps) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLS[status])} />
      {showLabel && <span>{t(STATUS_KEY[status])}</span>}
    </span>
  );
}
