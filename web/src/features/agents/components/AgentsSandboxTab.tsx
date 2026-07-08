import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Terminal,
} from "lucide-react";
import {
  apiPreviewPathHref,
  processUrlBrowserSource,
} from "@/features/drive/browserSources";
import { LightweightBrowserPane } from "@/features/drive/components/LightweightBrowserPane";
import {
  useSandboxProcessLogs,
  useSandboxProcesses,
  useSandboxRuntime,
  useStartSandboxProcess,
  useStopSandboxProcess,
} from "@/features/sandbox/api";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/store/projectContext";
import type { Agent } from "@/types/agents";
import type { SandboxProcess } from "@/types/sandbox";
import {
  EmptyState,
  PanelLoading,
} from "./AgentsNativeShared";
import { formatDate, profileFromAgent } from "./AgentsNativeUtils";

export function SandboxProcessesTab({
  profile,
  agents,
}: {
  profile: string | null;
  agents: Agent[];
}) {
  const { t } = useTranslation();
  const selectedProjectId = useProjectContext((s) => s.selectedProjectId);
  const runtime = useSandboxRuntime();
  const processes = useSandboxProcesses(profile, selectedProjectId);
  const startProcess = useStartSandboxProcess();
  const stopProcess = useStopSandboxProcess();
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const logs = useSandboxProcessLogs(selectedProcessId);
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      map.set(profileFromAgent(agent), agent);
    }
    return map;
  }, [agents]);
  const rows = processes.data?.processes ?? [];
  const canStart = Boolean(profile && command.trim() && !startProcess.isPending);
  const selectedProcess = rows.find((row) => row.id === selectedProcessId);

  function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !canStart) return;
    startProcess.mutate(
      {
        agentProfile: profile,
        projectId: selectedProjectId ?? undefined,
        command: command.trim(),
        cwd: cwd.trim() || undefined,
        port: port.trim() ? Number(port) : undefined,
        label: label.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          setCommand("");
          setCwd("");
          setPort("");
          setLabel("");
          setSelectedProcessId(res.process.id);
        },
      },
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--text)]">
              {t("agents.sandbox.runtime")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {runtime.data?.runtime.mode ?? "unknown"}
              {runtime.data?.runtime.dataRoot ? ` · ${runtime.data.runtime.dataRoot}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SandboxStatusPill
              status={runtime.data?.runtime.ready ? "ready" : "unavailable"}
            />
            <button
              type="button"
              onClick={() => {
                runtime.refetch();
                processes.refetch();
              }}
              className="h-8 w-8 rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              title={t("common.refresh")}
            >
              <RefreshCw className="mx-auto h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {runtime.data?.runtime.error && (
          <p className="mt-2 text-xs text-[var(--status-error)]">
            {runtime.data.runtime.error}
          </p>
        )}
      </section>

      {profile && (
        <form
          onSubmit={handleStart}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
            <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
            {t("agents.sandbox.startProcess")}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_minmax(0,1fr)_auto]">
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={t("agents.sandbox.command")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder={t("agents.sandbox.cwd")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
              placeholder={t("agents.sandbox.port")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("agents.sandbox.label")}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={!canStart}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startProcess.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={1.5} />
              )}
              {t("agents.sandbox.start")}
            </button>
          </div>
          {startProcess.isError && (
            <p className="mt-2 text-xs text-[var(--status-error)]">
              {t("agents.sandbox.startError")}
            </p>
          )}
        </form>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--text)]">
            {t("agents.sandbox.processes")}
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {t("common.units", { count: rows.length })}
          </span>
        </div>
        {processes.isLoading ? (
          <div className="p-4">
            <PanelLoading />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Terminal}
              title={t("agents.sandbox.emptyTitle")}
              message={t("agents.sandbox.empty")}
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((process) => {
              const agent = agentMap.get(process.agentProfile);
              const running = process.status === "running" || process.status === "starting";
              return (
                <div key={process.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedProcessId(process.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <SandboxStatusPill status={process.status} />
                        {!profile && (
                          <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
                            {agent?.name ?? process.agentProfile}
                          </span>
                        )}
                        {process.pid && (
                          <span className="text-[11px] text-[var(--text-faint)]">
                            PID {process.pid}
                          </span>
                        )}
                      </div>
                      <code className="mt-2 block truncate font-mono text-xs text-[var(--text)]">
                        {process.command}
                      </code>
                      <p className="mt-1 truncate text-[11px] text-[var(--text-faint)]">
                        {process.cwd} · {formatDate(process.startedAt)}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {processPreviewUrl(process) && (
                        <button
                          type="button"
                          onClick={() => setSelectedProcessId(process.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]"
                          title={t("agents.sandbox.openPreview")}
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => stopProcess.mutate(process.id)}
                        disabled={!running || stopProcess.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
                        title={t("agents.sandbox.stop")}
                      >
                        <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ProcessPreviewPanel process={selectedProcess} />

      {selectedProcessId && (
        <ProcessLogsPanel
          process={selectedProcess}
          logs={logs.data?.logs ?? ""}
          loading={logs.isLoading}
          onClose={() => setSelectedProcessId(null)}
        />
      )}
    </div>
  );
}

function ProcessPreviewPanel({ process }: { process?: SandboxProcess }) {
  const previewSource = process ? processPreviewSource(process) : null;
  if (!previewSource) return null;

  return (
    <section className="h-[420px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <LightweightBrowserPane source={previewSource} />
    </section>
  );
}

function ProcessLogsPanel({
  process,
  logs,
  loading,
  onClose,
}: {
  process?: SandboxProcess;
  logs: string;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">
            {t("agents.sandbox.logs")}
          </h2>
          {process && (
            <code className="mt-1 block truncate font-mono text-[11px] text-[var(--text-faint)]">
              {process.command}
            </code>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.cancel")}
        </button>
      </div>
      <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
        {loading ? t("common.loading") : logs || t("agents.sandbox.noLogs")}
      </pre>
    </section>
  );
}

function SandboxStatusPill({ status }: { status: string }) {
  const tone =
    status === "ready" || status === "running" || status === "done"
      ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
      : status === "failed" || status === "unavailable"
        ? "bg-[var(--status-error)]/10 text-[var(--status-error)]"
        : "bg-[var(--surface-hover)] text-[var(--text-muted)]";
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>
      {status}
    </span>
  );
}

function processPreviewSource(process: SandboxProcess) {
  const url = processPreviewUrl(process);
  if (!url) return null;
  return processUrlBrowserSource(url, processPreviewLabel(process));
}

function processPreviewUrl(process: SandboxProcess) {
  if (process.previewPath) return apiPreviewPathHref(process.previewPath);
  return process.previewTargetUrl ?? null;
}

function processPreviewLabel(process: SandboxProcess) {
  return (
    stringMetadata(process.metadata, "label") ??
    stringMetadata(process.metadata, "previewLabel") ??
    process.command
  );
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}
