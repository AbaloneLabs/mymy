
export type AgentStatus = "active" | "idle" | "offline";


export type AgentSource = "hermes" | "openclaw";


export type AgentModel = "qwen" | "openai" | "anthropic" | "local" | "unknown";


export interface Agent {
  id: string;

  name: string;

  role: string;

  description?: string;

  status: AgentStatus;

  source: AgentSource;

  model: AgentModel;

  avatarUrl?: string;

  profilePath?: string;

  lastActiveAt?: string;
}
