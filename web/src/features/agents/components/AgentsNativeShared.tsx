import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types/agents";

export function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--surface-active)] text-[var(--text-muted)]">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

export function Metric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-faint)]">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate text-xs text-[var(--text-muted)]",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function AgentAvatar({
  agent,
  profile,
}: {
  agent?: Agent;
  profile?: string;
}) {
  const label = agent?.name ?? profile ?? "?";
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-active)] text-sm font-semibold text-[var(--text)]">
      {label.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

export function AgentStatusDot({ status }: { status: Agent["status"] }) {
  return status === "active" ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-success)]" strokeWidth={1.75} />
  ) : status === "offline" ? (
    <XCircle className="h-3.5 w-3.5 text-[var(--status-error)]" strokeWidth={1.75} />
  ) : (
    <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
  );
}

export function PanelLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
      {t("common.loading")}
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return <div className="text-sm text-[var(--status-error)]">{message}</div>;
}

export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
      <div>
        <Icon
          className="mx-auto mb-3 h-6 w-6 text-[var(--text-faint)]"
          strokeWidth={1.5}
        />
        <div className="text-sm font-medium text-[var(--text)]">{title}</div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
  );
}
