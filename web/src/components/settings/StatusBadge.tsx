import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { InstanceStatus } from "@/types/settings";

const STYLES: Record<InstanceStatus, { dot: string; text: string }> = {
  connected: { dot: "bg-[var(--status-active)]", text: "text-[var(--status-active)]" },
  disconnected: { dot: "bg-[var(--status-error)]", text: "text-[var(--status-error)]" },
  pending: { dot: "bg-[var(--status-idle)]", text: "text-[var(--text-muted)]" },
};

const KEY: Record<InstanceStatus, string> = {
  connected: "status.connected",
  disconnected: "status.disconnected",
  pending: "status.pending",
};

interface StatusBadgeProps {
  status: InstanceStatus;
  className?: string;
}


export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const s = STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", s.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(KEY[status])}
    </span>
  );
}
