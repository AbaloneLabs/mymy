


export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  prompt?: string;
  deliver?: string;
  repeat?: string;
  skill?: string;
  script?: string;
  workdir?: string;
  nextRun?: string;
  paused: boolean;
}


export interface CronStatus {
  schedulerRunning: boolean;
  activeJobs: number;
  nextRun?: string;
  message?: string;
}


export interface CronResponse {
  jobs: CronJob[];
  status: CronStatus;
}

export interface CronResult {
  id: string;
  jobId: string;
  jobTitle: string;
  mode: string;
  status: "success" | "error" | "silent";
  output: string;
  outputPath?: string | null;
  createdAt: string;
}

export interface CronResultsResponse {
  results: CronResult[];
}


export interface GatewayStatus {
  running: boolean;
  model?: string;
  provider?: string;
  message?: string;
}


export interface AgentStatusResponse {
  gateway: GatewayStatus;
}

/* ---- Sessions (`hermes sessions list`) ---- */
export interface HermesSession {
  id: string;
  title?: string;
  lastActive?: string;
}

export interface SessionsResponse {
  sessions: HermesSession[];
}

/* ---- Skills (`hermes skills list`) ---- */
export interface HermesSkill {
  name: string;
  category?: string;
  source?: string;
  trust?: string;
  status?: string;
}

export interface SkillsResponse {
  skills: HermesSkill[];
}

/* ---- Memory (`hermes memory status` + USER.md) ---- */
export interface HermesMemory {
  builtinActive: boolean;
  installedPlugins: string[];
  userMemory?: string;
}

export interface MemoryResponse {
  memory: HermesMemory;
}

/* ---- Identity (`~/.hermes/SOUL.md`) ---- */
export interface HermesIdentity {
  name?: string;
  role?: string;
  content?: string;
}

export interface IdentityResponse {
  identity: HermesIdentity;
}

/* ---- Environment (`hermes status`) ---- */
export interface ApiKeyStatus {
  name: string;
  configured: boolean;
  detail?: string;
}

export interface AuthProviderStatus {
  name: string;
  loggedIn: boolean;
  detail?: string;
}

export interface HermesEnvironment {
  python?: string;
  model?: string;
  provider?: string;
  apiKeys: ApiKeyStatus[];
  authProviders: AuthProviderStatus[];
}

export interface EnvironmentResponse {
  environment: HermesEnvironment;
}
