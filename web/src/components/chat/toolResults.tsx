import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Boxes,
  Puzzle,
  Terminal,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./codeHighlight";
import { languageFromTitle } from "./codeLanguage";
import { MediaTagList } from "./media";
import type { ToolEvent } from "./types";
import {
  booleanValue,
  firstString,
  isScalar,
  jsonScalarSummary,
  numberValue,
  parseJsonObject,
  recordValue,
  recordsValue,
  stringArrayValue,
  stringValue,
} from "./toolResultUtils";
import {
  WebExtractResultPanel,
  WebSearchResultPanel,
} from "./toolResultWeb";
import { parseWebExtractResult, parseWebSearchResult } from "./toolResultWebParsers";
import {
  ExpandableFooter,
  MiniMeta,
  ToolPanelHeader,
  ToolStatusPill,
} from "./toolResultShared";
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

export function ToolEventRow({
  event,
  onOpenDocument,
}: {
  event: ToolEvent;
  onOpenDocument?: (path: string) => void;
}) {
  return (
    <ToolResultView
      name={event.name}
      status={event.status}
      argumentsText={event.arguments}
      detail={event.detail}
      onOpenDocument={onOpenDocument}
    />
  );
}

export function ToolResultView({
  name,
  status,
  argumentsText,
  detail,
  onOpenDocument,
}: {
  name: string;
  status: "running" | "done";
  argumentsText: string;
  detail: string;
  onOpenDocument?: (path: string) => void;
}) {
  if (name === "execute_code") {
    return (
      <CodeExecutionEvent
        event={{ id: name, sessionId: "", name, status, arguments: argumentsText, detail }}
      />
    );
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
        <ProcessListResultPanel result={processResult} status={status} />
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
      return <ProcessActionResultPanel result={actionResult} status={status} />;
    }
  }

  if (name === "terminal") {
    const terminalResult = parseTerminalResult(detail);
    if (terminalResult) {
      return <TerminalResultPanel result={terminalResult} status={status} />;
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
      return <PreviewResultPanel result={previewResult} status={status} />;
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

interface ReadFileResult {
  path: string;
  content: string;
  totalLines?: number;
  shownStart?: number;
  shownEnd?: number;
}

function ReadFileResultPanel({
  result,
  status,
}: {
  result: ReadFileResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const range =
    result.shownStart !== undefined && result.shownEnd !== undefined
      ? `${result.shownStart}-${result.shownEnd}`
      : undefined;
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="file"
        title={t("chat.readFileTitle")}
        status={status}
        meta={range ? t("chat.lineRange", { range }) : undefined}
      />
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
        {result.path}
      </div>
      {result.content && (
        <CodeBlock
          title={result.path.split("/").pop() || "file.txt"}
          content={result.content}
          language={languageFromTitle(result.path)}
        />
      )}
      {result.totalLines !== undefined && (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("chat.totalLines", { count: result.totalLines })}
        </div>
      )}
    </div>
  );
}

interface SearchFilesResult {
  matches: SearchFileMatch[];
}

interface SearchFileMatch {
  path: string;
  line?: number;
  preview: string;
}

function SearchFilesResultPanel({
  result,
  status,
}: {
  result: SearchFilesResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleMatches = expanded ? result.matches : result.matches.slice(0, 6);
  const hiddenCount = Math.max(result.matches.length - visibleMatches.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="search"
        title={t("chat.fileSearchTitle")}
        status={status}
        meta={t("chat.fileSearchCount", { count: result.matches.length })}
      />
      {result.matches.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {t("chat.noMatches")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2">
          {visibleMatches.map((match, index) => (
            <div
              key={`${match.path}:${match.line ?? index}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="truncate font-mono text-[10px] text-[var(--text-faint)]">
                {match.path}
                {match.line !== undefined ? `:${match.line}` : ""}
              </div>
              {match.preview && (
                <div className="mt-1 break-words font-mono text-[11px] text-[var(--text)]">
                  {match.preview}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ExpandableFooter
        expanded={expanded}
        hiddenCount={hiddenCount}
        onToggle={() => setExpanded((current) => !current)}
      />
    </div>
  );
}

interface FileMutationResult {
  path: string;
  bytesWritten?: number;
  linesWritten?: number;
  replacements?: number;
}

function FileMutationResultPanel({
  name,
  result,
  status,
  onOpenDocument,
}: {
  name: string;
  result: FileMutationResult;
  status: "running" | "done";
  onOpenDocument?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const canOpen = status === "done" && isDocumentEditorPath(result.path) && onOpenDocument;
  const content = (
    <>
      <ToolPanelHeader
        icon="file"
        title={name === "patch_file" ? t("chat.patchFileTitle") : t("chat.writeFileTitle")}
        status={status}
        ok
      />
      <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
        {result.path}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {result.bytesWritten !== undefined && (
          <MiniMeta value={`${result.bytesWritten} bytes`} />
        )}
        {result.linesWritten !== undefined && (
          <MiniMeta value={`${result.linesWritten} lines`} />
        )}
        {result.replacements !== undefined && (
          <MiniMeta value={`${result.replacements} replacement`} />
        )}
        {canOpen && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--accent)]">
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            {t("chat.openEditor")}
          </span>
        )}
      </div>
    </>
  );

  if (canOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpenDocument(result.path)}
        className="block max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left text-xs text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-hover)]"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      {content}
    </div>
  );
}

interface TodoResult {
  success: boolean;
  todos: ToolTodo[];
}

interface ToolTodo {
  id: string;
  content: string;
  status: string;
}

function TodoResultPanel({
  result,
  status,
}: {
  result: TodoResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="list"
        title={t("chat.todoTitle")}
        status={status}
        ok={result.success}
        meta={t("chat.todoCount", { count: result.todos.length })}
      />
      {result.todos.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {t("chat.todoEmpty")}
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5">
          {result.todos.map((todo) => (
            <div
              key={todo.id}
              className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <ToolStatusPill status={todo.status} />
              <div className="min-w-0 flex-1 break-words text-xs text-[var(--text)]">
                {todo.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type SessionSearchResult =
  | { mode: "discovery"; results: SessionSearchItem[] }
  | { mode: "browse"; sessions: SessionSearchItem[] }
  | { mode: "scroll"; sessionId: string; window: SessionSearchItem[] };

interface SessionSearchItem {
  sessionId?: string;
  messageId?: string;
  title?: string;
  role?: string;
  snippet?: string;
  preview?: string;
  content?: string;
  timestamp?: string;
}

function SessionSearchResultPanel({
  result,
  status,
}: {
  result: SessionSearchResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const items =
    result.mode === "browse"
      ? result.sessions
      : result.mode === "scroll"
        ? result.window
        : result.results;
  const visibleItems = expanded ? items : items.slice(0, 5);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="search"
        title={t("chat.sessionSearchTitle")}
        status={status}
        meta={`${result.mode} · ${items.length}`}
      />
      {visibleItems.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          {t("chat.noResults")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2">
          {visibleItems.map((item, index) => (
            <div
              key={`${item.sessionId}:${item.messageId}:${index}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {item.role && <ToolStatusPill status={item.role} />}
                <div className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text)]">
                  {item.title || item.sessionId || item.messageId || t("chat.sessionItem")}
                </div>
              </div>
              {(item.snippet || item.preview || item.content) && (
                <div className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-[var(--text-muted)]">
                  {item.snippet || item.preview || item.content}
                </div>
              )}
              {item.timestamp && (
                <div className="mt-1 font-mono text-[10px] text-[var(--text-faint)]">
                  {item.timestamp}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ExpandableFooter
        expanded={expanded}
        hiddenCount={hiddenCount}
        onToggle={() => setExpanded((current) => !current)}
      />
    </div>
  );
}

interface SkillsListResult {
  count: number;
  root: string;
  hint: string;
  categories: string[];
  skills: ToolSkill[];
}

interface ToolSkill {
  name: string;
  description: string;
  category: string;
}

function SkillsListResultPanel({
  result,
  status,
}: {
  result: SkillsListResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleSkills = expanded ? result.skills : result.skills.slice(0, 6);
  const hiddenCount = Math.max(result.skills.length - visibleSkills.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex flex-wrap items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Puzzle className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.skillsListTitle")}
        </span>
        <span>{t("chat.skillsListCount", { count: result.count })}</span>
      </div>

      {result.root && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {result.root}
        </div>
      )}
      {result.hint && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {result.hint}
        </div>
      )}
      {result.categories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.categories.map((category) => (
            <span
              key={category}
              className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
            >
              {category}
            </span>
          ))}
        </div>
      )}

      {result.skills.length === 0 ? (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("chat.skillsListEmpty")}
        </div>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {visibleSkills.map((skill) => (
            <div
              key={`${skill.category}:${skill.name}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="truncate font-mono text-xs text-[var(--text)]">
                {skill.name}
              </div>
              {skill.category && (
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                  {skill.category}
                </div>
              )}
              {skill.description && (
                <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--text-muted)]">
                  {skill.description}
                </div>
              )}
            </div>
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

interface SkillViewResult {
  usageHint: string;
  skill: Record<string, unknown>;
}

function SkillViewResultPanel({
  result,
  status,
}: {
  result: SkillViewResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const skillName = stringValue(result.skill, "name") || t("chat.skill");
  const filePath = stringValue(result.skill, "file_path", "filePath", "path");
  const content = stringValue(result.skill, "content", "markdown", "body");
  const description = stringValue(result.skill, "description");

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader icon="skill" title={skillName} status={status} />
      {filePath && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {filePath}
        </div>
      )}
      {description && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {description}
        </div>
      )}
      {content && (
        <CodeBlock
          title={filePath?.split("/").pop() || "SKILL.md"}
          content={content}
          language="markdown"
        />
      )}
      {result.usageHint && (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {result.usageHint}
        </div>
      )}
    </div>
  );
}

interface SkillBundleResult {
  success: boolean;
  bundles: ToolBundle[];
  bundle?: string;
  message?: string;
  instruction?: string;
}

interface ToolBundle {
  name: string;
  description: string;
  skills: string[];
}

function SkillBundleResultPanel({
  result,
  status,
}: {
  result: SkillBundleResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="skill"
        title={t("chat.skillBundleTitle")}
        status={status}
        ok={result.success}
      />
      {result.bundles.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {result.bundles.map((bundle) => (
            <div
              key={bundle.name}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="font-mono text-xs text-[var(--text)]">
                {bundle.name}
              </div>
              {bundle.description && (
                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">
                  {bundle.description}
                </div>
              )}
              {bundle.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {bundle.skills.map((skill) => (
                    <MiniMeta key={skill} value={skill} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {result.bundle && <MiniMeta value={result.bundle} />}
      {result.instruction && (
        <CodeBlock title="instruction.md" content={result.instruction} language="markdown" />
      )}
      {result.message && (
        <CodeBlock title="bundle-message.md" content={result.message} language="markdown" />
      )}
    </div>
  );
}

interface OperationResult {
  success?: boolean;
  result?: unknown;
  summary: [string, string][];
}

function OperationResultPanel({
  name,
  result,
  status,
}: {
  name: string;
  result: OperationResult;
  status: "running" | "done";
}) {
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="operation"
        title={name}
        status={status}
        ok={result.success}
      />
      {result.summary.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.summary.map(([key, value]) => (
            <MiniMeta key={key} value={`${key}=${value}`} />
          ))}
        </div>
      )}
      {result.result !== undefined && (
        <CodeBlock
          title="result.json"
          content={JSON.stringify(result.result, null, 2) ?? "null"}
          language="json"
        />
      )}
    </div>
  );
}

interface PreviewResult {
  id: string;
  label: string;
  targetUrl: string;
  previewPath: string;
}

function PreviewResultPanel({
  result,
  status,
}: {
  result: PreviewResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const previewHref = result.previewPath ? `${API_BASE}${result.previewPath}` : "";
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="network"
        title={t("chat.previewTitle")}
        status={status}
        ok
      />
      <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="text-sm font-medium text-[var(--text)]">
          {result.label || result.previewPath}
        </div>
        {result.targetUrl && (
          <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
            {result.targetUrl}
          </div>
        )}
        {previewHref && (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
          >
            {t("chat.openPreview")}
            <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
          </a>
        )}
      </div>
    </div>
  );
}

interface InvestmentSnapshotResult {
  summary: Record<string, unknown>;
  positions: Record<string, unknown>[];
  watchlist: Record<string, unknown>[];
}

function InvestmentSnapshotResultPanel({
  result,
  status,
}: {
  result: InvestmentSnapshotResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const metrics = [
    ["market", numberValue(result.summary, "marketValueAmount", "market_value_amount")],
    ["cost", numberValue(result.summary, "costBasisAmount", "cost_basis_amount")],
    ["p/l", numberValue(result.summary, "unrealizedPlAmount", "unrealized_pl_amount")],
    ["cashflow", numberValue(result.summary, "netCashflowAmount", "net_cashflow_amount")],
  ].filter((item): item is [string, number] => item[1] !== undefined);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="chart"
        title={t("chat.investmentSnapshotTitle")}
        status={status}
        meta={t("chat.positionCount", { count: result.positions.length })}
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              {label}
            </div>
            <div className="mt-1 font-mono text-sm text-[var(--text)]">
              {value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      {result.positions.length > 0 && (
        <CompactRecordList
          title={t("chat.positions")}
          records={result.positions}
          primaryKeys={["assetSymbol", "asset_symbol", "assetName", "asset_name", "id"]}
          secondaryKeys={["accountName", "account_name", "currency", "assetType", "asset_type"]}
          maxRows={5}
        />
      )}
      {result.watchlist.length > 0 && (
        <CompactRecordList
          title={t("chat.watchlist")}
          records={result.watchlist}
          primaryKeys={["assetSymbol", "asset_symbol", "assetName", "asset_name", "id"]}
          secondaryKeys={["targetPriceAmount", "target_price_amount", "currency"]}
          maxRows={5}
        />
      )}
    </div>
  );
}

interface CronResult {
  success?: boolean;
  jobs: Record<string, unknown>[];
  blueprints: Record<string, unknown>[];
  skills: string[];
  job?: Record<string, unknown>;
  summary: [string, string][];
}

function CronResultPanel({
  result,
  status,
}: {
  result: CronResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const rows = result.jobs.length > 0 ? result.jobs : result.blueprints;
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="operation"
        title={t("chat.cronTitle")}
        status={status}
        ok={result.success}
        meta={rows.length > 0 ? `${rows.length}` : undefined}
      />
      {result.summary.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.summary.map(([key, value]) => (
            <MiniMeta key={key} value={`${key}=${value}`} />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <CompactRecordList
          title={result.jobs.length > 0 ? t("chat.jobs") : t("chat.blueprints")}
          records={rows}
          primaryKeys={["title", "key", "id"]}
          secondaryKeys={["schedule", "defaultSchedule", "default_schedule", "nextRunAt", "next_run_at"]}
          maxRows={6}
        />
      )}
      {result.job && (
        <CompactRecordList
          title={t("chat.job")}
          records={[result.job]}
          primaryKeys={["title", "id"]}
          secondaryKeys={["schedule", "nextRunAt", "next_run_at", "enabled"]}
          maxRows={1}
        />
      )}
      {result.skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.skills.map((skill) => (
            <MiniMeta key={skill} value={skill} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ExtensionsStatusResult {
  success?: boolean;
  extensions: Record<string, unknown>[];
}

function ExtensionsStatusResultPanel({
  result,
  status,
}: {
  result: ExtensionsStatusResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="operation"
        title={t("chat.extensionsTitle")}
        status={status}
        ok={result.success}
        meta={`${result.extensions.length}`}
      />
      <CompactRecordList
        title={t("chat.extensions")}
        records={result.extensions}
        primaryKeys={["name", "id"]}
        secondaryKeys={["kind", "description"]}
        maxRows={8}
      />
    </div>
  );
}

interface McpResult {
  success?: boolean;
  server?: string;
  tool?: string;
  servers: Record<string, unknown>[];
  result?: unknown;
}

function McpResultPanel({
  name,
  result,
  status,
}: {
  name: string;
  result: McpResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <ToolPanelHeader
        icon="network"
        title={name}
        status={status}
        ok={result.success}
        meta={result.server ?? result.tool}
      />
      {result.servers.length > 0 && (
        <CompactRecordList
          title={t("chat.mcpServers")}
          records={result.servers}
          primaryKeys={["name"]}
          secondaryKeys={["transport", "configured"]}
          maxRows={8}
        />
      )}
      {result.result !== undefined && (
        <CodeBlock
          title="mcp-result.json"
          content={JSON.stringify(result.result, null, 2) ?? "null"}
          language="json"
        />
      )}
    </div>
  );
}

function JsonToolResultPanel({
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

function CompactRecordList({
  title,
  records,
  primaryKeys,
  secondaryKeys,
  maxRows,
}: {
  title: string;
  records: Record<string, unknown>[];
  primaryKeys: string[];
  secondaryKeys: string[];
  maxRows: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleRecords = expanded ? records : records.slice(0, maxRows);
  const hiddenCount = Math.max(records.length - visibleRecords.length, 0);

  if (records.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
        {title}: {t("chat.noResults")}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        {title}
      </div>
      <div className="grid gap-2">
        {visibleRecords.map((record, index) => {
          const primary = firstString(record, primaryKeys) || `#${index + 1}`;
          const secondary = secondaryKeys
            .map((key) => {
              const value = record[key];
              if (isScalar(value)) return `${key}=${String(value)}`;
              return "";
            })
            .filter(Boolean)
            .slice(0, 4);
          return (
            <div
              key={`${primary}:${index}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="break-words text-xs font-medium text-[var(--text)]">
                {primary}
              </div>
              {secondary.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {secondary.map((value) => (
                    <MiniMeta key={value} value={value} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ExpandableFooter
        expanded={expanded}
        hiddenCount={hiddenCount}
        onToggle={() => setExpanded((current) => !current)}
      />
    </div>
  );
}

function CodeExecutionEvent({ event }: { event: ToolEvent }) {
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

function parseReadFileResult(value: string): ReadFileResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const path = stringValue(parsed, "path");
  const content = stringValue(parsed, "content");
  if (!path && !content) return null;
  return {
    path,
    content,
    totalLines: numberValue(parsed, "total_lines", "totalLines"),
    shownStart: numberValue(parsed, "shown_start", "shownStart"),
    shownEnd: numberValue(parsed, "shown_end", "shownEnd"),
  };
}

function parseSearchFilesResult(value: string): SearchFilesResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.matches)) return null;
  return {
    matches: recordsValue(parsed, "matches").map((match) => ({
      path: stringValue(match, "path"),
      line: numberValue(match, "line"),
      preview: stringValue(match, "preview", "text", "lineText"),
    })),
  };
}

function parseFileMutationResult(value: string): FileMutationResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const path = stringValue(parsed, "path");
  if (!path) return null;
  return {
    path,
    bytesWritten: numberValue(parsed, "bytes_written", "bytesWritten"),
    linesWritten: numberValue(parsed, "lines_written", "linesWritten"),
    replacements: numberValue(parsed, "replacements"),
  };
}

function isDocumentEditorPath(path: string) {
  return /\.(md|markdown|txt|log|json|ya?ml|toml|csv|tsv|css|mjs|cjs|jsx?|tsx?|rs|py|sh|docx|xlsx|pptx)$/i.test(
    path,
  );
}

function parseTodoResult(value: string): TodoResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.todos)) return null;
  return {
    success: booleanValue(parsed, "success") ?? false,
    todos: recordsValue(parsed, "todos").map((todo) => ({
      id: stringValue(todo, "id"),
      content: stringValue(todo, "content"),
      status: stringValue(todo, "status"),
    })),
  };
}

function parseSessionSearchResult(value: string): SessionSearchResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const mode = stringValue(parsed, "mode");
  if (mode === "discovery") {
    return {
      mode,
      results: recordsValue(parsed, "results").map(parseSessionSearchItem),
    };
  }
  if (mode === "browse") {
    return {
      mode,
      sessions: recordsValue(parsed, "sessions").map(parseSessionSearchItem),
    };
  }
  if (mode === "scroll") {
    return {
      mode,
      sessionId: stringValue(parsed, "session_id", "sessionId"),
      window: recordsValue(parsed, "window").map(parseSessionSearchItem),
    };
  }
  return null;
}

function parseSessionSearchItem(value: Record<string, unknown>): SessionSearchItem {
  return {
    sessionId: stringValue(value, "session_id", "sessionId"),
    messageId: stringValue(value, "message_id", "messageId", "id"),
    title: stringValue(value, "title"),
    role: stringValue(value, "role"),
    snippet: stringValue(value, "snippet"),
    preview: stringValue(value, "preview"),
    content: stringValue(value, "content"),
    timestamp: stringValue(value, "timestamp", "created_at", "createdAt"),
  };
}

function parseSkillsListResult(value: string): SkillsListResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.skills)) return null;
  const skills = recordsValue(parsed, "skills").map((skill) => ({
    name: stringValue(skill, "name"),
    description: stringValue(skill, "description"),
    category: stringValue(skill, "category"),
  }));
  return {
    count: numberValue(parsed, "count") ?? skills.length,
    root: stringValue(parsed, "root"),
    hint: stringValue(parsed, "hint"),
    categories: stringArrayValue(parsed, "categories"),
    skills,
  };
}

function parseSkillViewResult(value: string): SkillViewResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const skill = recordValue(parsed, "skill");
  if (!skill) return null;
  return {
    usageHint: stringValue(parsed, "usage_hint", "usageHint"),
    skill,
  };
}

function parseSkillBundleResult(value: string): SkillBundleResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const bundleRecord = recordValue(parsed, "bundle");
  const bundles = recordsValue(parsed, "bundles");
  if (!bundleRecord && bundles.length === 0 && !("message" in parsed) && !("instruction" in parsed)) {
    return null;
  }
  const normalizedBundles = [
    ...bundles,
    ...(bundleRecord ? [bundleRecord] : []),
  ].map((bundle) => ({
    name: stringValue(bundle, "name"),
    description: stringValue(bundle, "description"),
    skills: stringArrayValue(bundle, "skills"),
  }));
  return {
    success: booleanValue(parsed, "success") ?? false,
    bundles: normalizedBundles,
    bundle: typeof parsed.bundle === "string" ? parsed.bundle : undefined,
    message: stringValue(parsed, "message"),
    instruction: stringValue(parsed, "instruction"),
  };
}

function parseOperationResult(value: string): OperationResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const result = parsed.result;
  const summary = jsonScalarSummary(parsed)
    .filter(([key]) => key !== "injection")
    .slice(0, 8);
  if (summary.length === 0 && result === undefined) return null;
  return {
    success: booleanValue(parsed, "success"),
    result,
    summary,
  };
}

function parsePreviewResult(value: string): PreviewResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const previewPath = stringValue(parsed, "preview_path", "previewPath");
  const targetUrl = stringValue(parsed, "target_url", "targetUrl");
  if (!previewPath && !targetUrl) return null;
  return {
    id: stringValue(parsed, "id"),
    label: stringValue(parsed, "label"),
    targetUrl,
    previewPath,
  };
}

function parseInvestmentSnapshotResult(value: string): InvestmentSnapshotResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const summary = recordValue(parsed, "summary");
  if (!summary) return null;
  return {
    summary,
    positions: recordsValue(parsed, "positions"),
    watchlist: recordsValue(parsed, "watchlist"),
  };
}

function parseCronResult(value: string): CronResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const jobs = recordsValue(parsed, "jobs");
  const blueprints = recordsValue(parsed, "blueprints");
  const job = recordValue(parsed, "job");
  const skills = stringArrayValue(parsed, "skills");
  const summary = jsonScalarSummary(parsed);
  if (jobs.length === 0 && blueprints.length === 0 && !job && skills.length === 0 && summary.length === 0) {
    return null;
  }
  return {
    success: booleanValue(parsed, "success"),
    jobs,
    blueprints,
    skills,
    job: job ?? undefined,
    summary,
  };
}

function parseExtensionsStatusResult(value: string): ExtensionsStatusResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed || !Array.isArray(parsed.extensions)) return null;
  return {
    success: booleanValue(parsed, "success"),
    extensions: recordsValue(parsed, "extensions"),
  };
}

function parseMcpResult(value: string): McpResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const servers = recordsValue(parsed, "servers");
  if (servers.length === 0 && !("result" in parsed) && !("server" in parsed)) return null;
  return {
    success: booleanValue(parsed, "success"),
    server: stringValue(parsed, "server"),
    tool: stringValue(parsed, "tool"),
    servers,
    result: parsed.result,
  };
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
