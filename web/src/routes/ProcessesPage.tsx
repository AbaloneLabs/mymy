import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAgents } from "@/features/agents/api";
import { ProcessesPageHeader } from "@/features/sandbox/components/ProcessesPageHeader";
import { SandboxProcessList } from "@/features/sandbox/components/SandboxProcessList";
import { SandboxProcessSidebar } from "@/features/sandbox/components/SandboxProcessSidebar";
import { SandboxRuntimePanel } from "@/features/sandbox/components/SandboxRuntimePanel";
import {
  useKillSandboxProcess,
  useSandboxProcessLogs,
  useSandboxProcesses,
  useSandboxRuntime,
  useStartSandboxProcess,
  useStopSandboxProcess,
} from "@/features/sandbox/api";
import { useProjects } from "@/features/projects/api";

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
      return rows.filter(
        (row) => row.status === "running" || row.status === "starting",
      );
    }
    return rows.filter((row) => row.status === statusFilter);
  }, [processes.data?.processes, statusFilter]);
  const selectedProcess = processRows.find((row) => row.id === selectedProcessId);

  function refresh() {
    void runtime.refetch();
    void processes.refetch();
    void logs.refetch();
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <ProcessesPageHeader
          agents={agentRows}
          projects={projectRows}
          agentProfile={agentProfile}
          projectId={projectId}
          statusFilter={statusFilter}
          onAgentProfileChange={setAgentProfile}
          onProjectIdChange={setProjectId}
          onStatusFilterChange={setStatusFilter}
          onRefresh={refresh}
        />

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] overflow-hidden">
          <section className="min-w-0 overflow-auto p-6">
            <SandboxRuntimePanel runtime={runtime.data?.runtime} />
            <SandboxProcessList
              processes={processRows}
              loading={processes.isLoading}
              selectedProcessId={selectedProcessId}
              onSelect={setSelectedProcessId}
              onStop={(processId) => stopProcess.mutate(processId)}
              onKill={(processId) => {
                if (window.confirm("프로세스를 강제 종료할까요?")) {
                  killProcess.mutate(processId);
                }
              }}
            />
          </section>

          <SandboxProcessSidebar
            agents={agentRows}
            projects={projectRows}
            selectedAgentProfile={agentProfile}
            selectedProjectId={projectId}
            selectedProcess={selectedProcess}
            logs={logs.data?.logs ?? ""}
            logsLoading={logs.isLoading}
            startPending={startProcess.isPending}
            onStart={(body) => {
              startProcess.mutate(body, {
                onSuccess: (res) => setSelectedProcessId(res.process.id),
              });
            }}
            onCloseLogs={() => setSelectedProcessId(null)}
          />
        </main>
      </div>
    </AppLayout>
  );
}
