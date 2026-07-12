


export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  prompt?: string;
  repeat?: string;
  skill?: string;
  script?: string;
  workdir?: string;
  nextRun?: string;
  paused: boolean;
  agentProfile?: string;
  projectId?: string;
  sessionPolicy: "new" | "reuse" | "result_only";
  catchUpPolicy: "skip" | "latest" | "all";
  retryPolicy: "none" | "safe";
  maxToolCalls: number;
  maxRuntimeSeconds: number;
  maxTotalTokens: number;
  lastRunId?: string;
  waitingDecisionId?: string;
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
  status: "success" | "error" | "silent" | "cancelled" | "skipped" | "blocked_security_review";
  output: string;
  outputPath?: string | null;
  createdAt: string;
}

export interface CronResultsResponse {
  results: CronResult[];
}

export interface QuarantinedCronJob {
  id: string;
  legacyJobId: string;
  title: string;
  wasEnabled: boolean;
  quarantineReason: string;
  quarantinedAt: string;
  priorResultCount: number;
  lastResultAt?: string;
}

export interface QuarantinedCronJobsResponse {
  jobs: QuarantinedCronJob[];
}

export interface QuarantinedCronJobDetailResponse {
  job: QuarantinedCronJob;
  originalDefinition: unknown;
}

export interface AgentMemory {
  id: string;
  sourceRunId?: string;
  sourceRunSnapshotId?: string;
  sourceDecisionId?: string;
  sourceSessionId?: string;
  sourceMessageStart?: string;
  sourceMessageEnd?: string;
  agentProfile: string;
  projectId?: string;
  memoryType: "preference" | "convention" | "decision" | "fact" | "temporal";
  origin: "explicit_user" | "agent_proposed" | "decision" | "conversation_inferred";
  scopeKind: "user_global" | "agent_profile" | "project" | "session";
  scopeId?: string;
  tier: "working" | "durable" | "curated";
  evidenceRole: "user_asserted" | "agent_observed_from_durable_result" | "external_source_claim" | "system_inferred";
  content: string;
  confidence: number;
  status:
    | "pending_review"
    | "active"
    | "conflict"
    | "stale"
    | "superseded"
    | "deleted";
  sensitivity: "normal" | "private" | "financial";
  validFrom: string;
  validUntil?: string;
  supersededBy?: string;
  createdAt: string;
  contentRevision: number;
  lifecycleRevision: number;
}

export interface MemoryExport {
  schemaVersion: "mymy-memory-export-v1";
  generatedAt: string;
  agentProfile: string;
  memories: AgentMemory[];
  deletedContentRetained: false;
  remoteDataShared: false;
}

export interface RunSummary {
  runId: string;
  agentProfile: string;
  projectId?: string;
  objective: string;
  outcome: string;
  summaryText: string;
  keyTopics: string[];
  sourceEventStart?: number;
  sourceEventEnd?: number;
  createdAt: string;
}

export interface MemoryEmbeddingSettings {
  agentProfile: string;
  enabled: boolean;
  provider: "local_feature_hash_v1";
  includePrivate: boolean;
  includeFinancial: boolean;
  remoteDataShared: false;
  disclosure: string;
}

export interface MemoryRuntimeSettings {
  agentProfile: string;
  automaticRecallEnabled: boolean;
  inferredExtractionEnabled: boolean;
  semanticIndexingEnabled: boolean;
  settingsRevision: number;
  updatedAt: string;
}
