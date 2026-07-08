import { Activity, RefreshCw } from "lucide-react";
import { selectClassName } from "./sandboxProcessUtils";

export function ProcessesPageHeader({
  agents,
  projects,
  agentProfile,
  projectId,
  statusFilter,
  onAgentProfileChange,
  onProjectIdChange,
  onStatusFilterChange,
  onRefresh,
}: {
  agents: Array<{ profile: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  agentProfile: string;
  projectId: string;
  statusFilter: string;
  onAgentProfileChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
      <Activity className="h-5 w-5 text-[var(--text-secondary)]" strokeWidth={1.5} />
      <h1 className="text-lg font-semibold">프로세스</h1>
      <div className="min-w-[160px] flex-1" />
      <select
        value={agentProfile}
        onChange={(event) => onAgentProfileChange(event.target.value)}
        className={selectClassName}
      >
        <option value="">모든 에이전트</option>
        {agents.map((agent) => (
          <option key={agent.profile} value={agent.profile}>
            {agent.name}
          </option>
        ))}
      </select>
      <select
        value={projectId}
        onChange={(event) => onProjectIdChange(event.target.value)}
        className={selectClassName}
      >
        <option value="">모든 프로젝트</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(event) => onStatusFilterChange(event.target.value)}
        className={selectClassName}
      >
        <option value="active">실행 중</option>
        <option value="all">전체</option>
        <option value="exited">종료</option>
        <option value="failed">실패</option>
        <option value="stopped">중지</option>
      </select>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
        title="새로고침"
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </header>
  );
}
