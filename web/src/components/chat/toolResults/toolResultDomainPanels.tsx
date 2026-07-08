import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import {
  apiPreviewPathHref,
  processUrlBrowserSource,
} from "@/features/drive/browserSources";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import { CodeBlock } from "../shared/codeHighlight";
import type {
  CronResult,
  ExtensionsStatusResult,
  InvestmentSnapshotResult,
  McpResult,
  OperationResult,
  PreviewResult,
  SessionSearchResult,
  TodoResult,
} from "./toolResultGeneralParsers";
import { CompactRecordList } from "./toolResultRecordList";
import {
  ExpandableFooter,
  MiniMeta,
  ToolPanelHeader,
  ToolStatusPill,
} from "./toolResultShared";
import { numberValue } from "./toolResultUtils";

export function TodoResultPanel({
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

export function SessionSearchResultPanel({
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

export function OperationResultPanel({
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

export function PreviewResultPanel({
  result,
  status,
  onOpenPreview,
}: {
  result: PreviewResult;
  status: "running" | "done";
  onOpenPreview?: (source: LightweightBrowserSource) => void;
}) {
  const { t } = useTranslation();
  const previewHref = result.previewPath ? apiPreviewPathHref(result.previewPath) : "";
  const previewSource: LightweightBrowserSource | null = previewHref
    ? processUrlBrowserSource(previewHref, result.label || result.previewPath || previewHref)
    : null;
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
        {previewHref && previewSource && (
          onOpenPreview ? (
            <button
              type="button"
              onClick={() => onOpenPreview(previewSource)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
            >
              {t("chat.openPreview")}
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
            </button>
          ) : (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
            >
              {t("chat.openPreview")}
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
            </a>
          )
        )}
      </div>
    </div>
  );
}

export function InvestmentSnapshotResultPanel({
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

export function CronResultPanel({
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

export function ExtensionsStatusResultPanel({
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

export function McpResultPanel({
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
