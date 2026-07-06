
export type AgentStatus = "active" | "idle" | "offline";


export type AgentSource = "native";


export type AgentModel = "qwen" | "openai" | "anthropic" | "local" | "unknown";

export type SandboxStatus = "pending" | "ready" | "reconciling" | "failed";

export type AgentToolDomain =
  | "prompts"
  | "memory"
  | "sessions"
  | "goals"
  | "calendar"
  | "tasks"
  | "knowledge"
  | "notes"
  | "drive"
  | "processes"
  | "finance"
  | "investments"
  | "agents";

export type AgentToolAccess = "access" | "read_only" | "denied";

export interface AgentToolPermission {
  domain: AgentToolDomain;
  access: AgentToolAccess;
}

export interface Agent {
  id: string;

  profile: string;

  name: string;

  role: string;

  description?: string;

  status: AgentStatus;

  source: AgentSource;

  model: AgentModel;

  avatarUrl?: string;

  profilePath?: string;

  drivePath: string;

  sandboxUid?: number;

  sandboxStatus: SandboxStatus;

  lastActiveAt?: string;

  toolPermissions: AgentToolPermission[];
}
