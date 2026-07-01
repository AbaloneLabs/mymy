


export type GitSystemType = "github" | "gitlab" | "gitea";


export type DiscoverySource = "auto" | "manual";


export type AgentSystemType = "hermes" | "openclaw";


export type InstanceStatus = "connected" | "disconnected" | "pending";


export interface AgentSystemInstance {

  id: string;

  type: AgentSystemType;

  label: string;

  enabled: boolean;

  source: DiscoverySource;

  connection: "local" | "remote";



  cliPath?: string;

  profileDir?: string;



  host?: string;

  port?: number;

  sshUser?: string;

  remoteCliPath?: string;

  remoteProfileDir?: string;



  detectedAgents?: number;

  status?: InstanceStatus;
}


export interface GitSystemConfig {
  type: GitSystemType;
  enabled: boolean;
  host: string;
  port: number;
  sshAlias: string;
  username: string;

  apiToken?: string;
}


export type Language = "en" | "ko" | "zh" | "ja";

export interface AppSettings {
  language: Language;
  agentSystems: AgentSystemInstance[];
  gitSystems: {
    github: GitSystemConfig;
    gitlab: GitSystemConfig;
    gitea: GitSystemConfig;
  };
}

// ---- LLM Providers ----

/** Wire format for API calls. "auto" resolves at runtime. */
export type ApiFormat = "openai" | "anthropic" | "auto";

/** A configured LLM provider, as returned by the API. */
export interface LlmProvider {
  id: string;
  label: string;
  api_format: ApiFormat;
  base_url: string;
  /** Masked hint of the API key, e.g. `sk-...7a2b`. */
  api_key_hint: string;
  model: string;
  max_tokens: number;
  is_default: boolean;
  enabled: boolean;
  preset: string | null;
}

/** Preset identifiers for the Add Provider dropdown. */
export type LlmProviderPreset =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "groq"
  | "together"
  | "deepseek"
  | "custom";

/** A single model entry from the model list endpoint. */
export interface ModelInfo {
  id: string;
  display_name: string;
  is_curated: boolean;
}

export type ModelListSource = "live" | "curated" | "error";
