


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
