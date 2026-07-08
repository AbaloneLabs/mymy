import { Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "../shared/codeHighlight";
import type { ToolEvent } from "../shared/types";
import { parseJsonObject } from "./toolResultUtils";

export function CodeExecutionEvent({ event }: { event: ToolEvent }) {
  const request = parseJsonObject(event.arguments);
  const result = parseJsonObject(event.detail);
  const code = typeof request?.code === "string" ? request.code : "";
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const exitCode =
    typeof result?.exit_code === "number" ? result.exit_code : undefined;
  const cwd = typeof result?.cwd === "string" ? result.cwd : undefined;
  const success = typeof result?.success === "boolean" ? result.success : undefined;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {event.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Terminal className="h-3 w-3" strokeWidth={1.5} />
        )}
        <span className="font-medium text-[var(--text)]">execute_code</span>
        {success !== undefined && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] uppercase",
              success
                ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
            )}
          >
            {success ? "ok" : "failed"}
          </span>
        )}
        {exitCode !== undefined && <span>exit {exitCode}</span>}
      </div>
      {cwd && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {cwd}
        </div>
      )}
      {code && <CodeBlock title="script.py" content={code} language="python" />}
      {stdout && <CodeBlock title="stdout" content={stdout} />}
      {stderr && <CodeBlock title="stderr" content={stderr} tone="error" />}
      {!result && event.detail && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 font-mono text-[11px]">
          {event.detail}
        </pre>
      )}
    </div>
  );
}
