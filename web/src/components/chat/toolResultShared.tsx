import { useTranslation } from "react-i18next";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Network,
  Puzzle,
  Search,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function ToolStatusPill({ status }: { status: string }) {
  const tone =
    status === "running" || status === "starting"
      ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
      : status === "failed"
        ? "bg-[var(--status-error)]/10 text-[var(--status-error)]"
        : "bg-[var(--surface-hover)] text-[var(--text-muted)]";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", tone)}>
      {status || "unknown"}
    </span>
  );
}

export function ToolPanelHeader({
  icon,
  title,
  status,
  ok,
  meta,
}: {
  icon: "terminal" | "file" | "search" | "skill" | "network" | "operation" | "list" | "chart";
  title: string;
  status: "running" | "done";
  ok?: boolean;
  meta?: string;
}) {
  const Icon =
    icon === "terminal"
      ? Terminal
      : icon === "file"
        ? FileText
        : icon === "search"
          ? Search
          : icon === "skill"
            ? Puzzle
            : icon === "network"
              ? Network
              : Boxes;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
      ) : (
        <Icon className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
      )}
      <span className="font-medium text-[var(--text)]">{title}</span>
      <span>{status}</span>
      {ok !== undefined && (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase",
            ok
              ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
              : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
          )}
        >
          {ok ? "ok" : "failed"}
        </span>
      )}
      {meta && <span>{meta}</span>}
    </div>
  );
}

export function MiniMeta({ value }: { value: string }) {
  return (
    <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
      {value}
    </span>
  );
}

export function ExpandableFooter({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  if (hiddenCount <= 0 && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
          {t("chat.showLess")}
        </>
      ) : (
        <>
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
          {t("chat.showMoreResults", { count: hiddenCount })}
        </>
      )}
    </button>
  );
}
