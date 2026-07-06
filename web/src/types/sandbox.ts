export interface SandboxRuntimeResponse {
  runtime: SandboxRuntime;
}

export interface SandboxRuntime {
  configured: boolean;
  mode: string;
  ready: boolean;
  dataRoot?: string;
  firecrackerConfigured: boolean;
  error?: string;
}

export type SandboxProcessStatus =
  | "starting"
  | "running"
  | "exited"
  | "failed"
  | "stopped";

export interface SandboxProcess {
  id: string;
  agentProfile: string;
  projectId?: string;
  command: string;
  cwd: string;
  status: SandboxProcessStatus;
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
  exitCode?: number;
  metadata: Record<string, unknown>;
  cpuPercent?: number;
  memoryBytes?: number;
  memoryLimitBytes?: number;
  storageBytes?: number;
  storageLimitBytes?: number;
  openPorts: number[];
  uptimeSeconds?: number;
  lastHeartbeatAt?: string;
  previewPath?: string;
  previewTargetUrl?: string;
}

export interface SandboxProcessesResponse {
  processes: SandboxProcess[];
}

export interface SandboxProcessResponse {
  process: SandboxProcess;
}

export interface SandboxProcessLogsResponse {
  process: SandboxProcess;
  logs: string;
}

export interface StopSandboxProcessResponse {
  success: boolean;
  process: SandboxProcess;
}

export interface StartSandboxProcessInput {
  agentProfile: string;
  projectId?: string;
  command: string;
  cwd?: string;
  port?: number;
  label?: string;
}
