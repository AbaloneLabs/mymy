import {
  booleanValue,
  numberArrayValue,
  numberValue,
  parseJsonObject,
  recordValue,
  recordsValue,
  stringValue,
} from "./toolResultUtils";

export interface ToolProcessListResult {
  processes: ToolProcess[];
}

export interface ToolProcess {
  id: string;
  agentProfile: string;
  command: string;
  cwd: string;
  status: string;
  pid?: number;
  exitCode?: number;
  port?: number;
  openPorts: number[];
  previewPath?: string;
  previewTargetUrl?: string;
  startedAt?: string;
  stoppedAt?: string;
}

export interface ProcessLogsResult {
  process: ToolProcess;
  logs: string;
}

export interface ProcessActionResult {
  success: boolean;
  process: ToolProcess;
}

export interface TerminalResult {
  background: boolean;
  processId: string;
  pid?: number;
  status: string;
  cwd: string;
  sandbox: string;
  previewPath?: string;
  forwardedUrl?: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export function parseProcessListResult(value: string): ToolProcessListResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const processes = recordsValue(parsed, "processes").map(parseToolProcess);
  if (!Array.isArray(parsed.processes)) return null;
  return { processes };
}

export function parseProcessLogsResult(value: string): ProcessLogsResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const process = recordValue(parsed, "process");
  if (!process) return null;
  return {
    process: parseToolProcess(process),
    logs: stringValue(parsed, "logs"),
  };
}

export function parseProcessActionResult(value: string): ProcessActionResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const process = recordValue(parsed, "process");
  if (!process) return null;
  return {
    success: booleanValue(parsed, "success") ?? false,
    process: parseToolProcess(process),
  };
}

function parseToolProcess(value: Record<string, unknown>): ToolProcess {
  const metadata = recordValue(value, "metadata") ?? {};
  const port = numberValue(value, "port") ?? numberValue(metadata, "port");
  const openPorts = numberArrayValue(value, "open_ports", "openPorts");
  return {
    id: stringValue(value, "id"),
    agentProfile: stringValue(value, "agent_profile", "agentProfile"),
    command: stringValue(value, "command"),
    cwd: stringValue(value, "cwd"),
    status: stringValue(value, "status") || stringValue(metadata, "runnerStatus"),
    pid: numberValue(value, "pid"),
    exitCode: numberValue(value, "exit_code", "exitCode"),
    port,
    openPorts,
    previewPath: stringValue(value, "preview_path", "previewPath"),
    previewTargetUrl:
      stringValue(value, "preview_target_url", "previewTargetUrl") ||
      stringValue(metadata, "forwardedUrl"),
    startedAt: stringValue(value, "started_at", "startedAt"),
    stoppedAt: stringValue(value, "stopped_at", "stoppedAt"),
  };
}

export function parseTerminalResult(value: string): TerminalResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const hasKnownField =
    "stdout" in parsed ||
    "stderr" in parsed ||
    "exit_code" in parsed ||
    "exitCode" in parsed ||
    "background" in parsed ||
    "process_id" in parsed;
  if (!hasKnownField) return null;
  return {
    background: booleanValue(parsed, "background") ?? false,
    processId: stringValue(parsed, "process_id", "processId"),
    pid: numberValue(parsed, "pid"),
    status: stringValue(parsed, "status"),
    cwd: stringValue(parsed, "cwd"),
    sandbox: stringValue(parsed, "sandbox"),
    previewPath: stringValue(parsed, "preview_path", "previewPath"),
    forwardedUrl: stringValue(parsed, "forwarded_url", "forwardedUrl"),
    stdout: stringValue(parsed, "stdout"),
    stderr: stringValue(parsed, "stderr"),
    exitCode: numberValue(parsed, "exit_code", "exitCode"),
  };
}
