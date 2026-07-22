/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatMessage, ChatSession } from "@/types/chat";
import {
  abortableRunDelay,
  isTerminalRun,
  readRunEvents,
} from "./runEventStream";
import { chatQueryKeys } from "./queryKeys";

/* -------------------------------------------------- Chat */

interface ChatSessionsResponse {
  sessions: ChatSession[];
}
interface ChatMessagesResponse {
  messages: ChatMessage[];
}

export interface SessionDeletionImpact {
  hasFutureCronRuns: boolean;
  cronJobTitle?: string;
  nextRunAt?: string;
}

export interface DeleteChatSessionInput {
  sessionId: string;
  confirmFutureCronDeletion: boolean;
}

export function getChatSessionDeletionImpact(sessionId: string) {
  return api.get<SessionDeletionImpact>(
    `/chat/sessions/${sessionId}/deletion-impact`,
  );
}

export function useChatSessions(projectId?: string, profile?: string) {
  return useQuery({
    queryKey: chatQueryKeys.sessions(projectId, profile),
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (profile) params.set("profile", profile);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<ChatSessionsResponse>(`/chat/sessions${qs}`);
    },
    // When projectId is undefined (global view), always fetch.
    // When provided, require it.
    enabled: projectId !== undefined ? Boolean(projectId) : true,
  });
}

export function useCreateChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { projectId?: string; profile?: string }) =>
      api.post<{ session: ChatSession }>("/chat/sessions", {
        projectId: vars.projectId ?? null,
        profile: vars.profile ?? null,
      }),
    onSuccess: (_data, vars) => {
      // Invalidate both the project-scoped (if any) and global session lists.
      if (vars.projectId) {
        qc.invalidateQueries({
          queryKey: chatQueryKeys.sessionScope(vars.projectId),
        });
      }
      qc.invalidateQueries({ queryKey: chatQueryKeys.sessionScope() });
    },
  });
}

export function useChatMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: chatQueryKeys.messages(sessionId),
    queryFn: () =>
      api.get<ChatMessagesResponse>(`/chat/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
  });
}

export type ChatSseEvent =
  | {
      type: "run_status";
      run_id: string;
      status: AgentRunStatus;
      cancel_requested: boolean;
    }
  | { type: "outcome_unknown"; run_id: string; message: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "text_delta"; content: string }
  | { type: "model_turn_started"; iteration: number }
  | { type: "checklist_changed"; items: RunChecklistEventItem[] }
  | { type: "checkpoint_created"; checkpoint_id: string; sequence: number }
  | {
      type: "decision_created";
      decision_id: string;
      kind: string;
      question: string;
      choices: unknown[];
      blocking: boolean;
    }
  | { type: "decision_resolved"; decision_id: string; kind: string }
  | {
      type: "tool_call_start";
      call_id: string;
      tool_name: string;
      arguments: string;
      resource_key?: string | null;
      capability?: {
        effect: string;
        risk: string;
        idempotency: string;
        parallelPolicy: string;
        resourceKind: string;
        dataSensitivity: string;
        cancellation: "cooperative" | "process_group" | "non_interruptible";
      } | null;
    }
  | {
      type: "tool_call_finish";
      call_id: string;
      result: string;
      error?: string | null;
      duration_ms: number;
    }
  | { type: "clarify"; request: ChatClarifyRequest }
  | { type: "turn_completed"; finish_reason: string; usage: unknown }
  | { type: "context_compressing" }
  | {
      type: "provider_retry_scheduled";
      run_id: string;
      retry_at: string;
      retry_count: number;
      message: string;
    }
  | { type: "provider_retry_requested"; run_id: string }
  | {
      type: "done";
      assistant_message?: ChatMessage | null;
      session: ChatSession;
      total_api_calls: number;
      total_tool_calls: number;
    }
  | { type: "error"; message: string };

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_decision"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  sessionId?: string;
  agentProfile: string;
  triggerType: "chat" | "cron" | "wake" | "delegate";
  triggerRef?: string;
  parentRunId?: string;
  parentEventId?: string;
  delegateIndex?: number;
  projectId?: string;
  status: AgentRunStatus;
  objective: string;
  promptVersion: string;
  leaseEpoch: number;
  latestSequence: number;
  leaseExpiresAt?: string;
  cancelRequestedAt?: string;
  startedAt?: string;
  heartbeatAt?: string;
  nextAttemptAt?: string;
  providerRetryCount: number;
  completedAt?: string;
  errorCode?: string;
  usage: unknown;
  createdAt: string;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  sequence: number;
  eventType: string;
  payloadVersion: number;
  visibility: "user";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunResourceEffect {
  id: string;
  resourceId: string;
  artifactId?: string;
  effectKind: string;
  beforeReference?: string;
  afterReference?: string;
  observedRevision?: string;
  resourceSequence: number;
  lifecycleState: string;
  currentPath?: string;
  createdAt: string;
}

export interface RunArtifact {
  id: string;
  resourceId: string;
  title: string;
  artifactType: string;
  mimeType: string;
  lifecycleState: string;
  lifecycleSequence: number;
  currentPath?: string;
}

export interface SessionRunInput {
  id: string;
  sessionId: string;
  clientRequestId: string;
  targetRunId?: string;
  kind: "message" | "follow_up";
  content: string;
  options: unknown;
  status: "queued" | "claimed" | "applied" | "cancelled";
  sequence: number;
  createdAt: string;
  appliedAt?: string;
}

export interface RunChecklistItem {
  id: string;
  runId: string;
  itemKey: string;
  content: string;
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
  position: number;
  blockedDecisionId?: string;
  verificationEventId?: string;
}

export interface RunChecklistEventItem {
  id: string;
  content: string;
  status: RunChecklistItem["status"];
  position: number;
}

export interface EnqueueChatRunResponse {
  input: SessionRunInput;
  run?: AgentRun;
  deduplicated: boolean;
}

interface AgentRunResponse {
  run: AgentRun;
}

export interface SessionRuntimeResponse {
  activeRun?: AgentRun;
  queuedInputs: SessionRunInput[];
  latestSequence: number;
}

interface SessionRunInputResponse {
  input: SessionRunInput;
}

export interface ChatClarifyRequest {
  requestId: string;
  sessionId: string;
  question: string;
  choices: string[];
  createdAt: string;
}

export function submitChatClarifyAnswer(
  sessionId: string,
  requestId: string,
  answer: string,
) {
  return api.post<{ success: boolean }>(
    `/chat/sessions/${sessionId}/clarify/${requestId}`,
    { answer },
  );
}

export function useSessionRuntime(sessionId: string | undefined) {
  return useQuery({
    queryKey: chatQueryKeys.runtime(sessionId),
    queryFn: () =>
      api.get<SessionRuntimeResponse>(`/chat/sessions/${sessionId}/runtime`),
    enabled: Boolean(sessionId),
    refetchInterval: 1_000,
  });
}

export function useAgentRuns(filters?: {
  status?: AgentRunStatus;
  triggerType?: AgentRun["triggerType"];
  projectId?: string;
  agentProfile?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: chatQueryKeys.runs(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.triggerType) params.set("triggerType", filters.triggerType);
      if (filters?.projectId) params.set("projectId", filters.projectId);
      if (filters?.agentProfile) params.set("agentProfile", filters.agentProfile);
      params.set("limit", String(filters?.limit ?? 50));
      return api.get<{ runs: AgentRun[] }>(`/agent-runs?${params.toString()}`);
    },
    refetchInterval: 5_000,
  });
}

export function useRunEventLog(runId: string | undefined) {
  return useQuery({
    queryKey: chatQueryKeys.eventLog(runId),
    queryFn: () =>
      api.get<{
        run: AgentRun;
        events: AgentRunEvent[];
        latestSequence: number;
      }>(`/agent-runs/${runId}/event-log`),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "queued" ||
        status === "running" ||
        status === "waiting_decision"
        ? 2_000
        : false;
    },
  });
}

export function useRunProvenance(runId: string | undefined) {
  return useQuery({
    queryKey: ["agent-runs", runId, "provenance"],
    queryFn: () =>
      api.get<{ effects: RunResourceEffect[]; artifacts: RunArtifact[] }>(
        `/agent-runs/${runId}/provenance`,
      ),
    enabled: Boolean(runId),
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

export function useRunChecklist(runId: string | undefined) {
  return useQuery({
    queryKey: chatQueryKeys.checklist(runId),
    queryFn: () =>
      api.get<{ items: RunChecklistItem[] }>(`/agent-runs/${runId}/checklist`),
    enabled: Boolean(runId),
    refetchInterval: 1_000,
  });
}

export function enqueueChatMessage(
  sessionId: string,
  clientRequestId: string,
  text: string,
  options: { useMoa?: boolean; moaPresetId?: string | null },
) {
  return enqueueChatRun(sessionId, clientRequestId, text, options);
}

export function updateQueuedChatInput(inputId: string, text: string) {
  return api.patch<SessionRunInputResponse>(`/session-run-inputs/${inputId}`, {
    text,
  });
}

export function cancelQueuedChatInput(inputId: string) {
  return api.delete<SessionRunInputResponse>(`/session-run-inputs/${inputId}`);
}

export function cancelAgentRun(runId: string) {
  return api.post<{ accepted: boolean; terminal: boolean; status: AgentRunStatus }>(
    `/agent-runs/${runId}/cancel`,
  );
}

export function retryAgentRun(runId: string) {
  return api.post<AgentRunResponse>(`/agent-runs/${runId}/retry`);
}

export async function streamChatMessage(
  sessionId: string,
  clientRequestId: string,
  text: string,
  options: { useMoa?: boolean; moaPresetId?: string | null },
  onEvent: (event: ChatSseEvent) => void,
) {
  const enqueued = await enqueueChatRun(sessionId, clientRequestId, text, options);
  if (!enqueued.run) {
    throw new Error("queued message has no target run");
  }
  let cursor = 0;
  let reconnectDelay = 250;
  while (true) {
    try {
      cursor = await readRunEvents(enqueued.run.id, cursor, onEvent);
      const current = await api.get<AgentRunResponse>(
        `/agent-runs/${enqueued.run.id}`,
      );
      if (isTerminalRun(current.run.status)) return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      const current = await api.get<AgentRunResponse>(
        `/agent-runs/${enqueued.run.id}`,
      );
      if (isTerminalRun(current.run.status)) return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, reconnectDelay));
    reconnectDelay = Math.min(reconnectDelay * 2, 2_000);
  }
}

export async function observeAgentRun(
  runId: string,
  afterSequence: number,
  onEvent: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
) {
  let cursor = afterSequence;
  let reconnectDelay = 250;
  while (true) {
    try {
      cursor = await readRunEvents(runId, cursor, onEvent, signal);
      const current = await api.get<AgentRunResponse>(`/agent-runs/${runId}`);
      if (isTerminalRun(current.run.status)) {
        return { cursor, run: current.run };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof TypeError)) throw error;
      const current = await api.get<AgentRunResponse>(`/agent-runs/${runId}`);
      if (isTerminalRun(current.run.status)) {
        return { cursor, run: current.run };
      }
    }
    await abortableRunDelay(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, 2_000);
  }
}

async function enqueueChatRun(
  sessionId: string,
  clientRequestId: string,
  text: string,
  options: { useMoa?: boolean; moaPresetId?: string | null },
) {
  const path = `/chat/sessions/${sessionId}/messages`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await api.post<EnqueueChatRunResponse>(path, {
        clientRequestId,
        text,
        useMoa: options.useMoa ?? false,
        moaPresetId: options.moaPresetId ?? null,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

export function useDeleteChatSession(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      confirmFutureCronDeletion,
    }: DeleteChatSessionInput) => {
      const query = confirmFutureCronDeletion
        ? "?confirmFutureCronDeletion=true"
        : "";
      return api.delete<{ success: boolean }>(
        `/chat/sessions/${sessionId}${query}`,
      );
    },
    onSuccess: () => {
      // Invalidate project-scoped (if known) and global session lists.
      if (projectId) {
        qc.invalidateQueries({
          queryKey: chatQueryKeys.sessionScope(projectId),
        });
      }
      qc.invalidateQueries({ queryKey: chatQueryKeys.sessionScope() });
    },
  });
}
