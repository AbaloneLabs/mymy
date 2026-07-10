import { Loader2 } from "lucide-react";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import { MediaTagList } from "../attachments/media";
import type { ToolEvent } from "../shared/types";
import { parseJsonObject } from "./toolResultUtils";
import {
  parseCronResult,
  parseExtensionsStatusResult,
  parseFileMutationResult,
  parseInvestmentSnapshotResult,
  parseMcpResult,
  parseOperationResult,
  parsePreviewResult,
  parseReadFileResult,
  parseSearchFilesResult,
  parseSessionSearchResult,
  parseSkillBundleResult,
  parseSkillViewResult,
  parseSkillsListResult,
  parseTodoResult,
} from "./toolResultGeneralParsers";
import {
  CronResultPanel,
  ExtensionsStatusResultPanel,
  FileMutationResultPanel,
  InvestmentSnapshotResultPanel,
  McpResultPanel,
  OperationResultPanel,
  PreviewResultPanel,
  ReadFileResultPanel,
  SearchFilesResultPanel,
  SessionSearchResultPanel,
  SkillBundleResultPanel,
  SkillViewResultPanel,
  SkillsListResultPanel,
  TodoResultPanel,
} from "./toolResultGeneralPanels";
import {
  WebExtractResultPanel,
  WebSearchResultPanel,
} from "./toolResultWeb";
import { parseWebExtractResult, parseWebSearchResult } from "./toolResultWebParsers";
import {
  ProcessActionResultPanel,
  ProcessListResultPanel,
  ProcessLogsResultPanel,
  TerminalResultPanel,
} from "./toolResultProcess";
import {
  parseProcessActionResult,
  parseProcessListResult,
  parseProcessLogsResult,
  parseTerminalResult,
} from "./toolResultProcessParsers";
import { CodeExecutionEvent } from "./toolResultCodeExecution";
import { JsonToolResultPanel } from "./toolResultJson";
import { DelegateResultPanel } from "./toolResultDelegate";
import { parseDelegateResult } from "./toolResultDelegateParser";

export function ToolEventRow({
  event,
  onOpenDocument,
  onOpenPreview,
}: {
  event: ToolEvent;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
}) {
  return (
    <div>
      <ToolResultView
        name={event.name}
        status={event.status}
        argumentsText={event.arguments}
        detail={event.detail}
        onOpenDocument={onOpenDocument}
        onOpenPreview={onOpenPreview}
      />
      {event.status === "running" && event.cancellation === "non_interruptible" && (
        <p className="mt-1 text-[10px] text-[var(--status-warning)]">
          이 작업은 즉시 중단되지 않으며 현재 단계와 정리가 끝날 때까지 실행 상태가 유지됩니다.
        </p>
      )}
    </div>
  );
}

export function ToolResultView({
  name,
  status,
  argumentsText,
  detail,
  onOpenDocument,
  onOpenPreview,
}: {
  name: string;
  status: "running" | "done";
  argumentsText: string;
  detail: string;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
}) {
  if (name === "execute_code") {
    return (
      <CodeExecutionEvent
        event={{ id: name, sessionId: "", name, status, arguments: argumentsText, detail }}
      />
    );
  }

  if (name === "delegate_task") {
    const delegateResult = parseDelegateResult(detail);
    if (delegateResult) {
      return <DelegateResultPanel result={delegateResult} />;
    }
  }

  if (name === "web_search") {
    const searchResult = parseWebSearchResult(detail);
    if (searchResult) {
      return <WebSearchResultPanel result={searchResult} status={status} />;
    }
  }

  if (name === "web_extract") {
    const extractResult = parseWebExtractResult(detail);
    if (extractResult) {
      return <WebExtractResultPanel result={extractResult} status={status} />;
    }
  }

  if (name === "list_processes") {
    const processResult = parseProcessListResult(detail);
    if (processResult) {
      return (
        <ProcessListResultPanel
          result={processResult}
          status={status}
          onOpenPreview={onOpenPreview}
        />
      );
    }
  }

  if (name === "read_process_logs") {
    const logsResult = parseProcessLogsResult(detail);
    if (logsResult) {
      return <ProcessLogsResultPanel result={logsResult} status={status} />;
    }
  }

  if (name === "stop_process" || name === "kill_process") {
    const actionResult = parseProcessActionResult(detail);
    if (actionResult) {
      return (
        <ProcessActionResultPanel
          result={actionResult}
          status={status}
          onOpenPreview={onOpenPreview}
        />
      );
    }
  }

  if (name === "terminal") {
    const terminalResult = parseTerminalResult(detail);
    if (terminalResult) {
      return (
        <TerminalResultPanel
          result={terminalResult}
          status={status}
          onOpenPreview={onOpenPreview}
        />
      );
    }
  }

  if (name === "read_file") {
    const fileResult = parseReadFileResult(detail);
    if (fileResult) {
      return <ReadFileResultPanel result={fileResult} status={status} />;
    }
  }

  if (name === "search_files") {
    const searchFilesResult = parseSearchFilesResult(detail);
    if (searchFilesResult) {
      return (
        <SearchFilesResultPanel result={searchFilesResult} status={status} />
      );
    }
  }

  if (name === "write_file" || name === "patch_file") {
    const fileMutationResult = parseFileMutationResult(detail);
    if (fileMutationResult) {
      return (
        <FileMutationResultPanel
          name={name}
          result={fileMutationResult}
          status={status}
          onOpenDocument={onOpenDocument}
        />
      );
    }
  }

  if (name === "todo") {
    const todoResult = parseTodoResult(detail);
    if (todoResult) {
      return <TodoResultPanel result={todoResult} status={status} />;
    }
  }

  if (name === "session_search") {
    const sessionResult = parseSessionSearchResult(detail);
    if (sessionResult) {
      return (
        <SessionSearchResultPanel result={sessionResult} status={status} />
      );
    }
  }

  if (name === "skills_list") {
    const skillsResult = parseSkillsListResult(detail);
    if (skillsResult) {
      return <SkillsListResultPanel result={skillsResult} status={status} />;
    }
  }

  if (name === "skill_view") {
    const skillViewResult = parseSkillViewResult(detail);
    if (skillViewResult) {
      return <SkillViewResultPanel result={skillViewResult} status={status} />;
    }
  }

  if (name === "skill_bundle") {
    const skillBundleResult = parseSkillBundleResult(detail);
    if (skillBundleResult) {
      return (
        <SkillBundleResultPanel result={skillBundleResult} status={status} />
      );
    }
  }

  if (name === "skill_manage" || name === "memory") {
    const operationResult = parseOperationResult(detail);
    if (operationResult) {
      return (
        <OperationResultPanel
          name={name}
          result={operationResult}
          status={status}
        />
      );
    }
  }

  if (name === "register_preview") {
    const previewResult = parsePreviewResult(detail);
    if (previewResult) {
      return (
        <PreviewResultPanel
          result={previewResult}
          status={status}
          onOpenPreview={onOpenPreview}
        />
      );
    }
  }

  if (name === "investment_snapshot") {
    const investmentResult = parseInvestmentSnapshotResult(detail);
    if (investmentResult) {
      return (
        <InvestmentSnapshotResultPanel
          result={investmentResult}
          status={status}
        />
      );
    }
  }

  if (name === "cronjob") {
    const cronResult = parseCronResult(detail);
    if (cronResult) {
      return <CronResultPanel result={cronResult} status={status} />;
    }
  }

  if (name === "extensions_status") {
    const extensionsResult = parseExtensionsStatusResult(detail);
    if (extensionsResult) {
      return (
        <ExtensionsStatusResultPanel
          result={extensionsResult}
          status={status}
        />
      );
    }
  }

  if (name === "mcp_status" || name === "mcp_list_tools" || name === "mcp_call") {
    const mcpResult = parseMcpResult(detail);
    if (mcpResult) {
      return <McpResultPanel name={name} result={mcpResult} status={status} />;
    }
  }

  const jsonResult = parseJsonObject(detail);
  if (jsonResult) {
    return (
      <JsonToolResultPanel
        name={name}
        status={status}
        result={jsonResult}
        raw={detail}
      />
    );
  }

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        )}
        <span className="font-medium text-[var(--text)]">{name}</span>
        <span>{status}</span>
      </div>
      {detail && (
        <>
          <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[11px]">
            {detail}
          </pre>
          <MediaTagList text={detail} />
        </>
      )}
    </div>
  );
}
