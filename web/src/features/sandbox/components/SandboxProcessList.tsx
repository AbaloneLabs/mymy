import {
  ExternalLink,
  Loader2,
  Skull,
  Square,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SandboxProcess } from "@/types/sandbox";
import {
  bytes,
  formatDuration,
  processPreviewUrl,
} from "./sandboxProcessUtils";

export function SandboxProcessList({
  processes,
  loading,
  selectedProcessId,
  onSelect,
  onStop,
  onKill,
}: {
  processes: SandboxProcess[];
  loading: boolean;
  selectedProcessId: string | null;
  onSelect: (processId: string) => void;
  onStop: (processId: string) => void;
  onKill: (processId: string) => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
          <h2 className="text-sm font-medium text-[var(--text)]">
            샌드박스 프로세스
          </h2>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{processes.length}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          불러오는 중
        </div>
      ) : processes.length === 0 ? (
        <p className="p-8 text-center text-sm text-[var(--text-faint)]">
          조건에 맞는 프로세스가 없습니다.
        </p>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {processes.map((process) => (
            <ProcessRow
              key={process.id}
              process={process}
              selected={process.id === selectedProcessId}
              onSelect={() => onSelect(process.id)}
              onStop={() => onStop(process.id)}
              onKill={() => onKill(process.id)}
            />
          ))}
        </div>
      )}
    </div>
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
            {process.pid && (
              <span className="text-[11px] text-[var(--text-faint)]">
                PID {process.pid}
              </span>
            )}
            {process.uptimeSeconds !== undefined && (
              <span className="text-[11px] text-[var(--text-faint)]">
                {formatDuration(process.uptimeSeconds)}
              </span>
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
        <Usage
          label="RAM"
          value={process.memoryBytes}
          display={bytes(process.memoryBytes)}
          max={process.memoryLimitBytes}
        />
        <Usage
          label="Storage"
          value={process.storageBytes}
          display={bytes(process.storageBytes)}
          max={process.storageLimitBytes}
        />
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
  const percentage =
    value === undefined ? 0 : max && max > 0 ? (value / max) * 100 : Math.min(value, 100);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono text-[var(--text)]">
          {display ?? (value === undefined ? "-" : `${value.toFixed(1)}${suffix ?? ""}`)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--surface-hover)]">
        <div
          className="h-full bg-[var(--accent)]"
          style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
        />
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
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>
      {status}
    </span>
  );
}
