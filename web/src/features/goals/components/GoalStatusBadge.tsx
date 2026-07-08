import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { GoalStatus } from "@/types/goals";
import { capitalize } from "./goalViewFormat";

export function StatusBadge({ status }: { status: GoalStatus }) {
  const { t } = useTranslation();
  const tone =
    status === "active"
      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
      : status === "completed"
        ? "bg-[var(--status-success)]/10 text-[var(--status-success)]"
        : "bg-[var(--surface-hover)] text-[var(--text-secondary)]";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
        tone,
      )}
    >
      {t(`goals.status${capitalize(status)}`)}
    </span>
  );
}
