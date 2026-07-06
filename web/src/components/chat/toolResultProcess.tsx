import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Terminal } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { CodeBlock } from "./codeHighlight";
import { MiniMeta, ToolPanelHeader, ToolStatusPill } from "./toolResultShared";

import type {
  ProcessActionResult,
  ProcessLogsResult,
  TerminalResult,
  ToolProcess,
  ToolProcessListResult,
} from "./toolResultProcessParsers";

export function ProcessListResultPanel({
  result,
  status,
}: {
  result: ToolProcessListResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleProcesses = expanded ? result.processes : result.processes.slice(0, 3);
  const hiddenCount = Math.max(result.processes.length - visibleProcesses.length, 0);
  const runningCount = result.processes.filter((process) =>
    ["running", "starting"].includes(process.status),
  ).length;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Terminal className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.processListTitle")}
        </span>
        <span>{t("chat.processListCount", { count: result.processes.length })}</span>
        {runningCount > 0 && (
          <span className="rounded bg-[var(--status-success,#22c55e)]/10 px-1.5 py-0.5 text-[10px] uppercase text-[var(--status-success,#22c55e)]">
            {t("chat.processRunningCount", { count: runningCount })}
          </span>
        )}
      </div>

      {result.processes.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("chat.processListEmpty")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2">
          {visibleProcesses.map((process) => (
            <ProcessResultItem key={process.id || process.command} process={process} />
          ))}
        </div>
      )}

      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
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
      ) : null}
    </div>
  );
}
function ProcessResultItem({ process }: { process: ToolProcess }) {
  const ports = [
    ...(process.port ? [process.port] : []),
    ...process.openPorts.filter((port) => port !== process.port),
  ];
  const previewHref = process.previewPath
    ? `${API_BASE}${process.previewPath}`
    : process.previewTargetUrl;

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ToolStatusPill status={process.status} />
        {process.agentProfile && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {process.agentProfile}
          </span>
        )}
        {process.pid !== undefined && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            PID {process.pid}
          </span>
        )}
        {ports.length > 0 && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            port {ports.join(", ")}
          </span>
        )}
        {process.exitCode !== undefined && (
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            exit {process.exitCode}
          </span>
        )}
        {previewHref && (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--accent-hover)] hover:underline"
          >
            preview
            <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          </a>
        )}
      </div>
      {process.command && (
        <div className="mt-1 break-words font-mono text-[11px] leading-relaxed text-[var(--text)]">
          {process.command}
        </div>
      )}
      {process.cwd && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {process.cwd}
        </div>
      )}
    </div>
  );
}

export function ProcessLogsResultPanel({
  result,
  status,
}: {
  result: ProcessLogsResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="terminal"
        title={t("chat.processLogsTitle")}
        status={status}
        meta={result.logs ? undefined : t("chat.noLogs")}
      />
      <div className="mt-2">
        <ProcessResultItem process={result.process} />
      </div>
      {result.logs && (
        <CodeBlock title="process.log" content={result.logs} language="text" />
      )}
    </div>
  );
}

export function ProcessActionResultPanel({
  result,
  status,
}: {
  result: ProcessActionResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="terminal"
        title={t("chat.processActionTitle")}
        status={status}
        ok={result.success}
      />
      <div className="mt-2">
        <ProcessResultItem process={result.process} />
      </div>
    </div>
  );
}

export function TerminalResultPanel({
  result,
  status,
}: {
  result: TerminalResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const ok = result.exitCode === undefined || result.exitCode === 0;
  const previewHref = result.previewPath
    ? `${API_BASE}${result.previewPath}`
    : result.forwardedUrl;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="terminal"
        title={result.background ? t("chat.backgroundProcessTitle") : t("chat.terminalTitle")}
        status={status}
        ok={ok}
        meta={
          result.exitCode !== undefined
            ? `exit ${result.exitCode}`
            : result.status || undefined
        }
      />
      <div className="mt-1 flex flex-wrap gap-1.5">
        {result.cwd && <MiniMeta value={result.cwd} />}
        {result.sandbox && <MiniMeta value={result.sandbox} />}
        {result.pid !== undefined && <MiniMeta value={`PID ${result.pid}`} />}
        {result.processId && <MiniMeta value={result.processId} />}
        {previewHref && (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent-hover)] hover:underline"
          >
            preview
          </a>
        )}
      </div>
      {result.stdout && <CodeBlock title="stdout" content={result.stdout} />}
      {result.stderr && <CodeBlock title="stderr" content={result.stderr} tone="error" />}
      {!result.stdout && !result.stderr && !result.background && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("chat.noOutput")}
        </div>
      )}
    </div>
  );
}
