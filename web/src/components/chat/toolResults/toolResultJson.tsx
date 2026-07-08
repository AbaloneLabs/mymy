import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "../shared/codeHighlight";
import { formatJson } from "./toolResultGeneralParsers";
import { jsonScalarSummary } from "./toolResultUtils";

export function JsonToolResultPanel({
  name,
  status,
  result,
  raw,
}: {
  name: string;
  status: "running" | "done";
  result: Record<string, unknown>;
  raw: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const summary = jsonScalarSummary(result);
  const hasError = typeof result.error === "string";

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Boxes className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">{name}</span>
        <span>{status}</span>
        {typeof result.success === "boolean" && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] uppercase",
              result.success
                ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
            )}
          >
            {result.success ? "ok" : "failed"}
          </span>
        )}
      </div>
      {hasError && (
        <div className="mt-2 rounded-md border border-[var(--status-error)]/50 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {String(result.error)}
        </div>
      )}
      {summary.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {summary.map(([key, value]) => (
            <span
              key={key}
              className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
            >
              {key}={value}
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
            {t("chat.hideRawJson")}
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            {t("chat.showRawJson")}
          </>
        )}
      </button>
      {expanded && (
        <CodeBlock title="result.json" content={formatJson(raw)} language="json" />
      )}
    </div>
  );
}
