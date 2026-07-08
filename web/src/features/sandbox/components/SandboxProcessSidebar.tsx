import { useState, type FormEvent } from "react";
import { Loader2, Plus, Terminal, X } from "lucide-react";
import { LightweightBrowserPane } from "@/features/drive/components/LightweightBrowserPane";
import type { SandboxProcess } from "@/types/sandbox";
import {
  inputClassName,
  processPreviewSource,
} from "./sandboxProcessUtils";

export interface StartProcessInput {
  agentProfile: string;
  projectId?: string;
  command: string;
  cwd?: string;
  port?: number;
  label?: string;
}

export function SandboxProcessSidebar({
  agents,
  projects,
  selectedAgentProfile,
  selectedProjectId,
  selectedProcess,
  logs,
  logsLoading,
  startPending,
  onStart,
  onCloseLogs,
}: {
  agents: Array<{ profile: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  selectedAgentProfile: string;
  selectedProjectId: string;
  selectedProcess?: SandboxProcess;
  logs: string;
  logsLoading: boolean;
  startPending: boolean;
  onStart: (body: StartProcessInput) => void;
  onCloseLogs: () => void;
}) {
  return (
    <aside className="min-h-0 overflow-auto border-l border-[var(--border)] p-4">
      <StartProcessPanel
        agents={agents}
        projects={projects}
        selectedAgentProfile={selectedAgentProfile}
        selectedProjectId={selectedProjectId}
        pending={startPending}
        onStart={onStart}
      />
      <ProcessPreviewPanel process={selectedProcess} />
      <LogsPanel
        process={selectedProcess}
        logs={logs}
        loading={logsLoading}
        onClose={onCloseLogs}
      />
    </aside>
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
  onStart: (body: StartProcessInput) => void;
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
    <form
      onSubmit={submit}
      className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
        <Terminal className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        프로세스 시작
      </div>
      <div className="space-y-2">
        <select
          value={effectiveAgent}
          onChange={(event) => setAgentProfile(event.target.value)}
          className={inputClassName}
        >
          <option value="">에이전트 선택</option>
          {agents.map((agent) => (
            <option key={agent.profile} value={agent.profile}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          value={projectId || selectedProjectId}
          onChange={(event) => setProjectId(event.target.value)}
          className={inputClassName}
        >
          <option value="">프로젝트 미지정</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="command"
          className={inputClassName}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            placeholder="/drive/agents/..."
            className={inputClassName}
          />
          <input
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
            placeholder="port"
            className={inputClassName}
          />
        </div>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="preview label"
          className={inputClassName}
        />
      </div>
      <button
        type="submit"
        disabled={!effectiveAgent || !command.trim() || pending}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        )}
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5 text-[var(--text-muted)]">
        {loading ? "불러오는 중" : logs || "로그가 없습니다."}
      </pre>
    </section>
  );
}
