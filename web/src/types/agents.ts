
export type AgentStatus = "active" | "idle" | "offline";


export type AgentSource = "native" | "hermes" | "openclaw";


export type AgentModel = "qwen" | "openai" | "anthropic" | "local" | "unknown";

export type SandboxStatus = "pending" | "ready" | "reconciling" | "failed";


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
}
