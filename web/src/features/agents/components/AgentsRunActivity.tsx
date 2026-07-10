import { AlertTriangle, ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelAgentRun,
  useAgentRuns,
  useRunEventLog,
  type AgentRunEvent,
} from "@/features/chat/api";
import type { Agent } from "@/types/agents";
import { formatDate } from "./AgentsNativeUtils";

export function RunActivity({
  agents,
  profile,
}: {
  agents: Agent[];
  profile?: string;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunId = searchParams.get("runId") ?? undefined;
  const runsQuery = useAgentRuns({ agentProfile: profile, limit: 20 });
  const eventLog = useRunEventLog(selectedRunId);
  const runs = runsQuery.data?.runs ?? [];
  const agentNames = new Map(agents.map((agent) => [agent.profile, agent.name]));

  function selectRun(runId?: string) {
    const next = new URLSearchParams(searchParams);
    if (runId) next.set("runId", runId);
    else next.delete("runId");
    next.set("tab", "overview");
    setSearchParams(next, { replace: true });
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 text-sm font-medium text-[var(--text)]">
        {t("agents.dashboard.recentActivity")}
      </div>
      {runs.length === 0 && !selectedRunId ? (
        <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("agents.dashboard.noActivity")}
        </div>
      ) : (
        <div className="space-y-2">
          {runs.slice(0, 8).map((run) => {
            const selected = selectedRunId === run.id;
            const leaseExpired =
              run.status === "running" &&
              Boolean(run.leaseExpiresAt) &&
              new Date(run.leaseExpiresAt ?? 0).getTime() < runsQuery.dataUpdatedAt;
            return (
              <div key={run.id} className="rounded-md border border-[var(--border)] bg-[var(--bg)]">
                <button
                  type="button"
                  onClick={() => selectRun(selected ? undefined : run.id)}
                  className="flex w-full items-center justify-between gap-3 p-2 text-left"
                >
                  <span className="shrink-0 text-[var(--text-faint)]">
                    {selected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--text)]">
                      {run.objective || run.triggerType}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-[var(--text-faint)]">
                      <span>{agentNames.get(run.agentProfile) ?? run.agentProfile}</span>
                      <span className="rounded bg-[var(--surface-active)] px-1">{run.triggerType}</span>
                      <span>{run.status}</span>
                      {run.parentRunId && <span>parent {run.parentRunId.slice(0, 8)}</span>}
                      {leaseExpired && (
                        <span className="flex items-center gap-1 text-[var(--status-warning)]">
                          <AlertTriangle className="h-3 w-3" /> lease expired
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {formatDate(run.completedAt ?? run.heartbeatAt ?? run.createdAt)}
                  </span>
                </button>
                {selected && <RunEventLog runId={run.id} query={eventLog} />}
              </div>
            );
          })}
          {selectedRunId && !runs.some((run) => run.id === selectedRunId) && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)]">
              <RunEventLog runId={selectedRunId} query={eventLog} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RunEventLog({
  runId,
  query,
}: {
  runId: string;
  query: ReturnType<typeof useRunEventLog>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelAgentRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
  if (query.isLoading) {
    return <div className="border-t border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">{t("common.loading")}</div>;
  }
  if (query.isError || !query.data) {
    return <div className="border-t border-[var(--border)] p-3 text-xs text-[var(--status-error)]">{t("agents.activity.loadError")}</div>;
  }
  const { run, events } = query.data;
  return (
    <div className="space-y-3 border-t border-[var(--border)] p-3">
      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-faint)]">
        <code>{runId}</code>
        <span>{run.status}</span>
        <span>{t("agents.activity.eventCount", { count: events.length })}</span>
        <span>{usageLabel(run.usage)}</span>
        <span>{runDuration(run.startedAt, run.completedAt ?? run.heartbeatAt)}</span>
        {(run.status === "queued" ||
          run.status === "running" ||
          run.status === "waiting_decision") && (
          <button
            type="button"
            disabled={cancel.isPending || Boolean(run.cancelRequestedAt)}
            onClick={() => cancel.mutate()}
            className="ml-auto rounded px-2 py-0.5 text-[var(--status-error)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            {run.cancelRequestedAt
              ? t("agents.activity.cancelling")
              : t("agents.activity.cancel")}
          </button>
        )}
      </div>
      <ol className="max-h-80 space-y-1.5 overflow-y-auto">
        {events.map((event) => (
          <li key={event.id} className="flex gap-2 text-[11px]">
            <span className="w-10 shrink-0 font-mono text-[var(--text-faint)]">#{event.sequence}</span>
            <Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-faint)]" />
            <span className="min-w-0 text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">{event.eventType}</span>
              {eventSummary(event) && <span> · {eventSummary(event)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function eventSummary(event: AgentRunEvent) {
  const payload = event.payload;
  if (event.eventType === "tool_call_start") {
    return text(payload.tool_name) ?? text(payload.resource_key) ?? "";
  }
  if (event.eventType === "tool_call_finish") {
    const duration = number(payload.duration_ms);
    return duration === undefined ? "" : `${duration}ms`;
  }
  if (event.eventType === "run_status") return text(payload.status) ?? "";
  if (event.eventType === "outcome_unknown" || event.eventType === "error") {
    return text(payload.message) ?? "";
  }
  if (event.eventType === "checklist_changed") {
    return Array.isArray(payload.items) ? `${payload.items.length} items` : "";
  }
  return "";
}

function usageLabel(usage: unknown) {
  if (!usage || typeof usage !== "object") return "";
  const record = usage as Record<string, unknown>;
  const toolCalls = number(record.totalToolCalls) ?? number(record.total_tool_calls);
  const apiCalls = number(record.totalApiCalls) ?? number(record.total_api_calls);
  const totalTokens = number(record.totalTokens) ?? number(record.total_tokens);
  if (toolCalls === undefined && apiCalls === undefined && totalTokens === undefined) return "";
  return `${apiCalls ?? 0} API · ${toolCalls ?? 0} tools · ${totalTokens ?? 0} tokens`;
}

function runDuration(start?: string, end?: string) {
  if (!start || !end) return "";
  const duration = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  if (!Number.isFinite(duration)) return "";
  return `${Math.round(duration / 1000)}s`;
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
