import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMcpServers, type McpServerStatus } from "@/features/mcp/api";

export function McpServersPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMcpServers();
  const servers = data?.servers ?? [];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-[var(--text)]">
          {t("settings.extensions.mcpServers")}
        </h3>
      </div>
      {isLoading && (
        <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}
      {!isLoading && isError && (
        <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 text-xs text-[var(--status-error)]">
          {t("settings.extensions.mcpLoadError")}
        </div>
      )}
      {!isLoading && !isError && servers.length === 0 && (
        <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.extensions.mcpEmpty")}
        </div>
      )}
      {!isLoading && !isError && servers.length > 0 && (
        <div className="space-y-2">
          {servers.map((server) => (
            <McpServerCard key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpServerCard({ server }: { server: McpServerStatus }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--text)]">
              {server.name}
            </span>
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {server.transport}
            </span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {server.source} · {server.toolCount} {t("settings.extensions.mcpTools")}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            server.healthy
              ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
              : "bg-[var(--status-error)]/10 text-[var(--status-error)]"
          }`}
        >
          {server.healthy ? (
            <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
          )}
          {server.healthy
            ? t("settings.extensions.mcpHealthy")
            : t("settings.extensions.mcpUnhealthy")}
        </span>
      </div>
      {server.error && (
        <p className="mt-2 text-xs text-[var(--status-error)]">{server.error}</p>
      )}
      {server.tools.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {server.tools.map((tool) => (
            <div
              key={tool.prefixedName}
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
            >
              <div className="font-mono text-xs text-[var(--text)]">
                {tool.prefixedName}
              </div>
              {tool.description && (
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {tool.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
