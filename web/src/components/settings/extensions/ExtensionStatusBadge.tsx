import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentExtension } from "@/features/extensions/api";

export function ExtensionStatusBadge({
  extension,
}: {
  extension: AgentExtension;
}) {
  const { t } = useTranslation();
  const healthy = extension.status.state === "callable";
  const configured = extension.status.state === "configured";
  const disabled = extension.status.state === "disabled";
  const Icon = healthy || configured ? CheckCircle2 : AlertTriangle;
  const className = healthy
    ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
    : configured
      ? "bg-[var(--surface-hover)] text-[var(--text-muted)]"
      : disabled
        ? "bg-[var(--surface-hover)] text-[var(--text-faint)]"
        : "bg-[var(--status-error)]/10 text-[var(--status-error)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${className}`}>
      <Icon className="h-3 w-3" strokeWidth={1.5} />
      {t(`settings.extensions.status.${extension.status.state}`)}
    </span>
  );
}
