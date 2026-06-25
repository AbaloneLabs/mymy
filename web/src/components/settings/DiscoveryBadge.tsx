import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { DiscoverySource } from "@/types/settings";

const STYLES: Record<DiscoverySource, string> = {
  auto: "border-[var(--status-active)]/30 bg-[var(--status-active)]/10 text-[var(--status-active)]",
  manual: "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]",
};

const KEY: Record<DiscoverySource, string> = {
  auto: "discovery.auto",
  manual: "discovery.manual",
};

interface DiscoveryBadgeProps {
  source: DiscoverySource;
  className?: string;
}


export function DiscoveryBadge({ source, className }: DiscoveryBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        STYLES[source],
        className
      )}
    >
      {t(KEY[source])}
    </span>
  );
}
