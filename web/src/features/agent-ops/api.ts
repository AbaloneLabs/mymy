/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AgentMemory,
  CronJob,
  CronResultsResponse,
  CronResponse,
  QuarantinedCronJobDetailResponse,
  QuarantinedCronJobsResponse,
  RunSummary,
  MemoryEmbeddingSettings,
  MemoryExport,
  MemoryRuntimeSettings,
} from "@/types/agent-ops";

const NATIVE_CRON_QUERY_KEY = ["agent-ops", "cron", "native"] as const;
const QUARANTINED_CRON_QUERY_KEY = [
  "agent-ops",
  "cron",
  "quarantined",
] as const;

export function useRuntimeMemories(profile: string | null, query: string) {
  return useQuery({
    queryKey: ["agent-ops", "runtime-memory", profile, query],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100", scope: "all" });
      if (profile) params.set("agentProfile", profile);
      if (query.trim()) params.set("q", query.trim());
      return api.get<{ memories: AgentMemory[] }>(
        `/runtime-memory?${params.toString()}`,
      );
    },
  });
}

export function exportRuntimeMemories(profile: string) {
  return api.get<MemoryExport>(
    `/runtime-memory/export/${encodeURIComponent(profile)}`,
  );
}

export function useRunSummaries(profile: string | null, query: string) {
  return useQuery({
    queryKey: ["agent-ops", "run-summaries", profile, query],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25", scope: "all" });
      if (profile) params.set("agentProfile", profile);
      if (query.trim()) params.set("q", query.trim());
      return api.get<{ summaries: RunSummary[] }>(
        `/run-summaries?${params.toString()}`,
      );
    },
  });
}

export function useReviewRuntimeMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      expectedContentRevision,
      expectedLifecycleRevision,
      idempotencyKey,
    }: {
      id: string;
      action: "approve" | "stale" | "delete";
      expectedContentRevision: number;
      expectedLifecycleRevision: number;
      idempotencyKey: string;
    }) =>
      api.post<AgentMemory>(`/runtime-memory/${id}/review`, {
        action,
        expectedContentRevision,
        expectedLifecycleRevision,
        idempotencyKey,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["agent-ops", "runtime-memory"],
      }),
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: ["agent-ops", "runtime-memory"],
      }),
  });
}

export function useMemoryEmbeddingSettings(profile: string | null) {
  return useQuery({
    queryKey: ["agent-ops", "runtime-memory", "settings", profile],
    queryFn: () =>
      api.get<MemoryEmbeddingSettings>(
        `/runtime-memory/settings/${encodeURIComponent(profile ?? "")}`,
      ),
    enabled: Boolean(profile),
  });
}

export function useUpdateMemoryEmbeddingSettings(profile: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      includePrivate: boolean;
      includeFinancial: boolean;
    }) =>
      api.put<MemoryEmbeddingSettings>(
        `/runtime-memory/settings/${encodeURIComponent(profile)}`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-ops", "runtime-memory"],
      });
    },
  });
}

export function useMemoryRuntimeSettings(profile: string | null) {
  return useQuery({
    queryKey: ["agent-ops", "runtime-memory", "runtime-settings", profile],
    queryFn: () =>
      api.get<MemoryRuntimeSettings>(
        `/runtime-memory/runtime-settings/${encodeURIComponent(profile ?? "")}`,
      ),
    enabled: Boolean(profile),
  });
}

export function useUpdateMemoryRuntimeSettings(profile: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      automaticRecallEnabled: boolean;
      inferredExtractionEnabled: boolean;
      semanticIndexingEnabled: boolean;
      expectedSettingsRevision: number;
    }) =>
      api.put<MemoryRuntimeSettings>(
        `/runtime-memory/runtime-settings/${encodeURIComponent(profile)}`,
        body,
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-ops", "runtime-memory", "runtime-settings", profile],
      });
    },
  });
}

/* -------------------------------------------------- Agent Operations */

/**
 * Fetch native cron jobs + scheduler status.
 * Polls every 30s for near-real-time scheduler status.
 *
 * Cron jobs are currently global. `instanceId` and `profile` remain in the
 * signature so agent-scoped tabs can share the same panel component until
 * backend job scoping is added.
 */
export function useCronJobs(
  instanceId: string | null,
  profile: string | null,
) {
  void instanceId;
  void profile;
  return useQuery({
    queryKey: NATIVE_CRON_QUERY_KEY,
    queryFn: async () => {
      const [jobsResponse, status] = await Promise.all([
        api.get<NativeCronJobsResponse>("/cron/jobs"),
        api.get<NativeCronStatusResponse>("/cron/status"),
      ]);
      return {
        jobs: jobsResponse.jobs
          .map(toCronJob)
          .filter((job) => !profile || job.agentProfile === profile),
        status: {
          schedulerRunning: status.schedulerRunning,
          activeJobs: status.activeJobs,
          nextRun: status.nextRunAt,
          message: status.tickerAlive
            ? `${status.timezone}`
            : `${status.timezone} · heartbeat stale`,
        },
      } satisfies CronResponse;
    },
    enabled: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useCronResults(limit = 10) {
  return useQuery({
    queryKey: ["agent-ops", "cron-results", limit],
    queryFn: () => api.get<CronResultsResponse>(`/cron/results?limit=${limit}`),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export interface SaveCronJobRequest {
  title: string;
  prompt: string;
  schedule: string;
  maxRuns?: number | null;
  enabled?: boolean;
  skills?: string[];
  contextFrom?: string[];
  wakeAgent?: boolean;
  agentProfile?: string | null;
  projectId?: string | null;
  sessionPolicy?: "new" | "reuse" | "result_only";
  catchUpPolicy?: "skip" | "latest" | "all";
  retryPolicy?: "none" | "safe";
  maxToolCalls?: number;
  maxRuntimeSeconds?: number;
  maxTotalTokens?: number;
}

export interface CronBlueprint {
  key: string;
  title: string;
  description: string;
  category: string;
  defaultSchedule: string;
  formSchema: { fields?: CronBlueprintField[] };
  promptTemplate: string;
  suggestedSkills: string[];
  deliver: string;
}

export interface CronBlueprintField {
  name: string;
  type: "string" | "boolean";
  required?: boolean;
  default?: string | boolean;
}

export function useCreateCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveCronJobRequest) => api.post<CronResponse>("/cron/jobs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: NATIVE_CRON_QUERY_KEY }),
  });
}

export function useUpdateCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<SaveCronJobRequest> }) =>
      api.patch<CronResponse>(`/cron/jobs/${vars.id}`, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: NATIVE_CRON_QUERY_KEY }),
  });
}

export function useCronBlueprints() {
  return useQuery({
    queryKey: ["agent-ops", "cron-blueprints"],
    queryFn: () => api.get<{ blueprints: CronBlueprint[] }>("/cron/blueprints"),
  });
}

export function useInstantiateCronBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      key: string;
      values: Record<string, string | boolean>;
      title?: string;
      schedule?: string;
      enabled?: boolean;
      agentProfile: string;
      projectId?: string | null;
    }) =>
      api.post<CronResponse>(`/cron/blueprints/${vars.key}/instantiate`, {
        values: vars.values,
        title: vars.title,
        schedule: vars.schedule,
        enabled: vars.enabled,
        agentProfile: vars.agentProfile,
        projectId: vars.projectId ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: NATIVE_CRON_QUERY_KEY }),
  });
}

export function usePauseCronJob() {
  return useCronJobMutation((id) => api.post<CronResponse>(`/cron/jobs/${id}/pause`));
}

export function useResumeCronJob() {
  return useCronJobMutation((id) => api.post<CronResponse>(`/cron/jobs/${id}/resume`));
}

export function useTriggerCronJob() {
  return useCronJobMutation((id) => api.post<CronResponse>(`/cron/jobs/${id}/trigger`));
}

export function useDeleteCronJob() {
  return useCronJobMutation((id) => api.delete<CronResponse>(`/cron/jobs/${id}`));
}

export function useQuarantinedCronJobs() {
  return useQuery({
    queryKey: QUARANTINED_CRON_QUERY_KEY,
    queryFn: () =>
      api.get<QuarantinedCronJobsResponse>(
        "/cron/security/quarantined-jobs",
      ),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useQuarantinedCronJobDetail(
  id: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...QUARANTINED_CRON_QUERY_KEY, id],
    queryFn: () =>
      api.get<QuarantinedCronJobDetailResponse>(
        `/cron/security/quarantined-jobs/${id}`,
      ),
    enabled,
  });
}

export function useExportQuarantinedCronJob() {
  return useMutation({
    mutationFn: (id: string) =>
      api.get<QuarantinedCronJobDetailResponse>(
        `/cron/security/quarantined-jobs/${id}/export`,
      ),
  });
}

export function useDeleteQuarantinedCronJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(
        `/cron/security/quarantined-jobs/${id}`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: QUARANTINED_CRON_QUERY_KEY }),
  });
}

function useCronJobMutation(mutationFn: (id: string) => Promise<CronResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NATIVE_CRON_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["agent-ops", "cron-results"] });
    },
  });
}

interface NativeCronJobsResponse {
  jobs: NativeCronJob[];
}

interface NativeCronJob {
  id: string;
  title: string;
  prompt: string;
  schedule: NativeSchedule;
  enabled: boolean;
  next_run_at: string;
  run_count: number;
  max_runs?: number | null;
  skills?: string[];
  agent_profile?: string;
  project_id?: string;
  session_policy?: "new" | "reuse" | "result_only";
  catch_up_policy?: "skip" | "latest" | "all";
  retry_policy?: "none" | "safe";
  max_tool_calls?: number;
  max_runtime_seconds?: number;
  max_total_tokens?: number;
  last_run_id?: string;
  waiting_decision_id?: string;
}

type NativeSchedule =
  | { kind: "once"; at: string }
  | { kind: "interval"; seconds: number }
  | { kind: "cron"; expression: string };

interface NativeCronStatusResponse {
  schedulerRunning: boolean;
  activeJobs: number;
  nextRunAt?: string;
  tickerAlive: boolean;
  tickerFiring: boolean;
  heartbeatAgeSecs?: number;
  timezone: string;
}

function toCronJob(job: NativeCronJob): CronJob {
  return {
    id: job.id,
    name: job.title,
    schedule: scheduleLabel(job.schedule),
    prompt: job.prompt,
    repeat: job.max_runs ? `${job.run_count}/${job.max_runs}` : undefined,
    skill: job.skills?.join(", "),
    nextRun: job.next_run_at,
    paused: !job.enabled,
    agentProfile: job.agent_profile,
    projectId: job.project_id,
    sessionPolicy: job.session_policy ?? "new",
    catchUpPolicy: job.catch_up_policy ?? "latest",
    retryPolicy: job.retry_policy ?? "safe",
    maxToolCalls: job.max_tool_calls ?? 100,
    maxRuntimeSeconds: job.max_runtime_seconds ?? 1_800,
    maxTotalTokens: job.max_total_tokens ?? 200_000,
    lastRunId: job.last_run_id,
    waitingDecisionId: job.waiting_decision_id,
  };
}

function scheduleLabel(schedule: NativeSchedule): string {
  switch (schedule.kind) {
    case "once":
      return `once ${schedule.at}`;
    case "interval":
      return `every ${schedule.seconds}s`;
    case "cron":
      return schedule.expression;
  }
}

export interface PromptFile {
  path: string;
  exists: boolean;
  content: string;
  updatedAt?: string;
}

export interface AgentPromptsResponse {
  profile: string;
  agentsMd: PromptFile;
  soulMd: PromptFile;
}

export interface UpdateAgentPromptsRequest {
  agentsMd?: string;
  soulMd?: string;
}

export function useAgentPrompts(profile: string | null) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-prompts", profile],
    queryFn: () => api.get<AgentPromptsResponse>(`/agent-prompts${params}`),
    enabled: Boolean(profile),
  });
}

export function useUpdateAgentPrompts(profile: string | null) {
  const qc = useQueryClient();
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useMutation({
    mutationFn: (body: UpdateAgentPromptsRequest) =>
      api.put<AgentPromptsResponse>(`/agent-prompts${params}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-prompts", profile] });
    },
  });
}
