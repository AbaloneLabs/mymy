/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AgentStatusResponse,
  CronJob,
  CronResultsResponse,
  CronResponse,
  EnvironmentResponse,
  IdentityResponse,
  MemoryResponse,
  SessionsResponse,
  SkillsResponse,
} from "@/types/agent-ops";

const NATIVE_CRON_QUERY_KEY = ["agent-ops", "cron", "native"] as const;

/* -------------------------------------------------- Agent Ops (Hermes) */

/**
 * Fetch cron jobs + scheduler status for an agent system instance.
 * Polls every 30s for near-real-time scheduler status.
 *
 * The `profile` param scopes the query to a specific Hermes profile
 * (e.g. "default", "elena") — this is how the TopBar agent filter works.
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
        jobs: jobsResponse.jobs.map(toCronJob),
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
  mode?: "agent" | "no_agent";
  maxRuns?: number | null;
  enabled?: boolean;
  skills?: string[];
  contextFrom?: string[];
  wakeAgent?: boolean;
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
    }) =>
      api.post<CronResponse>(`/cron/blueprints/${vars.key}/instantiate`, {
        values: vars.values,
        title: vars.title,
        schedule: vars.schedule,
        enabled: vars.enabled,
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
  mode: "agent" | "no_agent";
  enabled: boolean;
  next_run_at: string;
  run_count: number;
  max_runs?: number | null;
  skills?: string[];
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
    deliver: job.mode,
    repeat: job.max_runs ? `${job.run_count}/${job.max_runs}` : undefined,
    skill: job.skills?.join(", "),
    nextRun: job.next_run_at,
    paused: !job.enabled,
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

/**
 * Fetch gateway + model status for an agent system instance.
 * Polls every 60s.
 */
export function useAgentStatus(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "status", instanceId, profile],
    queryFn: () =>
      api.get<AgentStatusResponse>(
        `/agent-systems/${instanceId}/status${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch recent chat sessions for an agent system instance.
 * Polls every 60s.
 */
export function useAgentSessions(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "sessions", instanceId, profile],
    queryFn: () =>
      api.get<SessionsResponse>(
        `/agent-systems/${instanceId}/sessions${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Delete a Hermes chat session. Delegates to `hermes sessions delete`.
 * On success, invalidates the sessions list so it refetches.
 */
export function useDeleteAgentSession(
  instanceId: string | null,
  profile: string | null,
) {
  const qc = useQueryClient();
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(
        `/agent-systems/${instanceId}/sessions/${sessionId}${params}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["agent-ops", "sessions", instanceId, profile],
      });
    },
  });
}

/**
 * Fetch installed skills for an agent system instance.
 * Polls every 120s (skills rarely change).
 */
export function useAgentSkills(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "skills", instanceId, profile],
    queryFn: () =>
      api.get<SkillsResponse>(
        `/agent-systems/${instanceId}/skills${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch memory status for an agent system instance.
 * Polls every 120s.
 */
export function useAgentMemory(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "memory", instanceId, profile],
    queryFn: () =>
      api.get<MemoryResponse>(
        `/agent-systems/${instanceId}/memory${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch agent identity (SOUL.md) for an agent system instance.
 * Polls every 300s (identity rarely changes).
 */
export function useAgentIdentity(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "identity", instanceId, profile],
    queryFn: () =>
      api.get<IdentityResponse>(
        `/agent-systems/${instanceId}/identity${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Fetch environment (python, model, API keys, auth providers) for an agent system instance.
 * Polls every 120s.
 */
export function useAgentEnvironment(
  instanceId: string | null,
  profile: string | null,
) {
  const params = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return useQuery({
    queryKey: ["agent-ops", "environment", instanceId, profile],
    queryFn: () =>
      api.get<EnvironmentResponse>(
        `/agent-systems/${instanceId}/environment${params}`,
      ),
    enabled: Boolean(instanceId),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
}
