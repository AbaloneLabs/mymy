import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Skull,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import {
  apiPreviewPathHref,
  processUrlBrowserSource,
} from "@/features/drive/browserSources";
import { LightweightBrowserPane } from "@/features/drive/components/LightweightBrowserPane";
import { useProjects } from "@/features/projects/api";
import {
  useKillSandboxProcess,
  useSandboxProcessLogs,
  useSandboxProcesses,
  useSandboxRuntime,
  useStartSandboxProcess,
  useStopSandboxProcess,
} from "@/features/sandbox/api";
import { cn } from "@/lib/utils";
import type { SandboxProcess } from "@/types/sandbox";

export default function ProcessesPage() {
  const agents = useAgents();
  const projects = useProjects();
  const runtime = useSandboxRuntime();
  const [agentProfile, setAgentProfile] = useState("");
  const [projectId, setProjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const processes = useSandboxProcesses(agentProfile || null, projectId || null);
  const startProcess = useStartSandboxProcess();
  const stopProcess = useStopSandboxProcess();
  const killProcess = useKillSandboxProcess();
  const logs = useSandboxProcessLogs(selectedProcessId);

  const agentRows = agents.data?.agents ?? [];
  const projectRows = projects.data?.projects ?? [];
  const processRows = useMemo(() => {
    const rows = processes.data?.processes ?? [];
    if (statusFilter === "all") return rows;
    if (statusFilter === "active") {
      return rows.filter((row) => row.status === "running" || row.status === "starting");
    }
    return rows.filter((row) => row.status === statusFilter);
  }, [processes.data?.processes, statusFilter]);
  const selectedProcess = processRows.find((row) => row.id === selectedProcessId);

  function refresh() {
    runtime.refetch();
    processes.refetch();
    logs.refetch();
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <Activity className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
          <h1 className="text-lg font-semibold">프로세스</h1>
          <div className="min-w-[160px] flex-1" />
          <select value={agentProfile} onChange={(event) => setAgentProfile(event.target.value)} className={selectClassName}>
            <option value="">모든 에이전트</option>
            {agentRows.map((agent) => (
              <option key={agent.profile} value={agent.profile}>
                {agent.name}
              </option>
            ))}
          </select>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={selectClassName}>
            <option value="">모든 프로젝트</option>
            {projectRows.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={selectClassName}>
            <option value="active">실행 중</option>
            <option value="all">전체</option>
            <option value="exited">종료</option>
            <option value="failed">실패</option>
            <option value="stopped">중지</option>
          </select>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] overflow-hidden">
          <section className="min-w-0 overflow-auto p-6">
            <RuntimePanel runtime={runtime.data?.runtime} />
            <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
                  <h2 className="text-sm font-medium text-[var(--text)]">샌드박스 프로세스</h2>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{processRows.length}</span>
              </div>
              {processes.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-[var(--text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  불러오는 중
                </div>
              ) : processRows.length === 0 ? (
                <p className="p-8 text-center text-sm text-[var(--text-faint)]">
                  조건에 맞는 프로세스가 없습니다.
                </p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {processRows.map((process) => (
                    <ProcessRow
                      key={process.id}
                      process={process}
                      selected={process.id === selectedProcessId}
                      onSelect={() => setSelectedProcessId(process.id)}
                      onStop={() => stopProcess.mutate(process.id)}
                      onKill={() => {
                        if (window.confirm("프로세스를 강제 종료할까요?")) {
                          killProcess.mutate(process.id);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-auto border-l border-[var(--border)] p-4">
            <StartProcessPanel
              agents={agentRows}
              projects={projectRows}
              selectedAgentProfile={agentProfile}
              selectedProjectId={projectId}
              pending={startProcess.isPending}
              onStart={(body) => {
                startProcess.mutate(body, {
                  onSuccess: (res) => setSelectedProcessId(res.process.id),
                });
              }}
            />
            <ProcessPreviewPanel process={selectedProcess} />
            <LogsPanel
              process={selectedProcess}
              logs={logs.data?.logs ?? ""}
              loading={logs.isLoading}
              onClose={() => setSelectedProcessId(null)}
            />
          </aside>
        </main>
      </div>
    </AppLayout>
  );
}

function RuntimePanel({ runtime }: { runtime?: { mode: string; ready: boolean; dataRoot?: string; error?: string } }) {
  return (
    <section className="grid gap-3 lg:grid-cols-4">
      <Metric label="상태" value={runtime?.ready ? "ready" : "unavailable"} tone={runtime?.ready ? "good" : "bad"} />
      <Metric label="모드" value={runtime?.mode ?? "unknown"} />
      <Metric label="데이터 루트" value={runtime?.dataRoot ?? "-"} />
      <Metric label="오류" value={runtime?.error ?? "-"} tone={runtime?.error ? "bad" : undefined} />
    </section>
  );
}

function ProcessRow({
  process,
  selected,
  onSelect,
  onStop,
  onKill,
}: {
  process: SandboxProcess;
  selected: boolean;
  onSelect: () => void;
  onStop: () => void;
  onKill: () => void;
}) {
  const running = process.status === "running" || process.status === "starting";
  const hasPreview = Boolean(processPreviewUrl(process));
  return (
    <div className={cn("p-4", selected && "bg-[var(--surface-hover)]")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={process.status} />
            <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
              {process.agentProfile}
            </span>
            {process.pid && <span className="text-[11px] text-[var(--text-faint)]">PID {process.pid}</span>}
            {process.uptimeSeconds !== undefined && (
              <span className="text-[11px] text-[var(--text-faint)]">{formatDuration(process.uptimeSeconds)}</span>
            )}
          </div>
          <code className="mt-2 block truncate font-mono text-xs text-[var(--text)]">
            {process.command}
          </code>
          <p className="mt-1 truncate text-[11px] text-[var(--text-faint)]">
            {process.cwd}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {hasPreview && (
            <button
              type="button"
              onClick={onSelect}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--accent)]"
              title="프리뷰 열기"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            disabled={!running}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
            title="중지"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onKill}
            disabled={!running}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-faint)] hover:bg-[var(--surface)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
            title="강제 종료"
          >
            <Skull className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Usage label="CPU" value={process.cpuPercent} suffix="%" max={100} />
        <Usage label="RAM" value={process.memoryBytes} display={bytes(process.memoryBytes)} max={process.memoryLimitBytes} />
        <Usage label="Storage" value={process.storageBytes} display={bytes(process.storageBytes)} max={process.storageLimitBytes} />
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
          <p className="text-[11px] text-[var(--text-muted)]">Ports</p>
          <p className="mt-1 truncate font-mono text-xs text-[var(--text)]">
            {process.openPorts.length > 0 ? process.openPorts.join(", ") : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

function ProcessPreviewPanel({ process }: { process?: SandboxProcess }) {
  const previewSource = process ? processPreviewSource(process) : null;
  if (!previewSource) return null;

  return (
    <section className="mb-4 h-[420px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <LightweightBrowserPane source={previewSource} />
    </section>
  );
}

function StartProcessPanel({
  agents,
  projects,
  selectedAgentProfile,
  selectedProjectId,
  pending,
  onStart,
}: {
  agents: Array<{ profile: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  selectedAgentProfile: string;
  selectedProjectId: string;
  pending: boolean;
  onStart: (body: { agentProfile: string; projectId?: string; command: string; cwd?: string; port?: number; label?: string }) => void;
}) {
  const [agentProfile, setAgentProfile] = useState(selectedAgentProfile);
  const [projectId, setProjectId] = useState(selectedProjectId);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const effectiveAgent = agentProfile || selectedAgentProfile;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveAgent || !command.trim()) return;
    onStart({
      agentProfile: effectiveAgent,
      projectId: projectId || selectedProjectId || undefined,
      command: command.trim(),
      cwd: cwd.trim() || undefined,
      port: port.trim() ? Number(port) : undefined,
      label: label.trim() || undefined,
    });
    setCommand("");
    setCwd("");
    setPort("");
    setLabel("");
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        프로세스 시작
      </div>
      <div className="space-y-2">
        <select value={effectiveAgent} onChange={(event) => setAgentProfile(event.target.value)} className={inputClassName}>
          <option value="">에이전트 선택</option>
          {agents.map((agent) => (
            <option key={agent.profile} value={agent.profile}>
              {agent.name}
            </option>
          ))}
        </select>
        <select value={projectId || selectedProjectId} onChange={(event) => setProjectId(event.target.value)} className={inputClassName}>
          <option value="">프로젝트 미지정</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="command" className={inputClassName} />
        <div className="grid grid-cols-2 gap-2">
          <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/drive/agents/..." className={inputClassName} />
          <input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))} placeholder="port" className={inputClassName} />
        </div>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="preview label" className={inputClassName} />
      </div>
      <button
        type="submit"
        disabled={!effectiveAgent || !command.trim() || pending}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <Plus className="h-4 w-4" strokeWidth={1.5} />}
        시작
      </button>
    </form>
  );
}

function LogsPanel({
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
  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--text)]">로그</h2>
          <code className="mt-1 block truncate font-mono text-[11px] text-[var(--text-faint)]">
            {process?.command ?? "프로세스를 선택하세요"}
          </code>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
        {loading ? "불러오는 중" : logs || "로그가 없습니다."}
      </pre>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 truncate font-mono text-sm text-[var(--text)]",
          tone === "good" && "text-[var(--status-success)]",
          tone === "bad" && "text-[var(--status-error)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Usage({
  label,
  value,
  display,
  suffix,
  max,
}: {
  label: string;
  value?: number;
  display?: string;
  suffix?: string;
  max?: number;
}) {
  const percentage = value === undefined ? 0 : max && max > 0 ? (value / max) * 100 : Math.min(value, 100);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono text-[var(--text)]">
          {display ?? (value === undefined ? "-" : `${value.toFixed(1)}${suffix ?? ""}`)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--surface-hover)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-[var(--status-success-bg)] text-[var(--status-success)]"
      : status === "failed"
        ? "bg-[var(--status-error)]/10 text-[var(--status-error)]"
        : "bg-[var(--surface-hover)] text-[var(--text-muted)]";
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{status}</span>;
}

const selectClassName =
  "h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--text)]";

const inputClassName =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]";

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

function bytes(value?: number) {
  if (value === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
