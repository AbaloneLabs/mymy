/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE, ApiError, api } from "@/lib/api";
import type { ChatMessage, ChatSession } from "@/types/chat";

/* -------------------------------------------------- Chat */

interface ChatSessionsResponse {
  sessions: ChatSession[];
}
interface ChatMessagesResponse {
  messages: ChatMessage[];
}

export function useChatSessions(projectId?: string, profile?: string) {
  return useQuery({
    queryKey: ["chat", "sessions", projectId ?? "all", profile ?? "all"],
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
          queryKey: ["chat", "sessions", vars.projectId],
        });
      }
      qc.invalidateQueries({ queryKey: ["chat", "sessions", "all"] });
    },
  });
}

export function useChatMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["chat", "messages", sessionId],
    queryFn: () =>
      api.get<ChatMessagesResponse>(`/chat/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
  });
}

export type ChatSseEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "text_delta"; content: string }
  | { type: "reasoning_delta"; content: string }
  | { type: "tool_call_start"; call_id: string; tool_name: string; arguments: string }
  | { type: "tool_call_finish"; call_id: string; result: string; error?: string | null }
  | { type: "approval_required"; request: ChatApprovalRequest }
  | { type: "clarify"; request: ChatClarifyRequest }
  | { type: "turn_completed"; finish_reason: string; usage: unknown }
  | { type: "context_compressing" }
  | {
      type: "done";
      assistant_message?: ChatMessage | null;
      session: ChatSession;
      total_api_calls: number;
      total_tool_calls: number;
    }
  | { type: "error"; message: string };

export interface ChatApprovalRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  command: string;
  patternKey: string;
  description: string;
  severity: "hardline" | "dangerous" | string;
  createdAt: string;
}

export interface ChatClarifyRequest {
  requestId: string;
  sessionId: string;
  question: string;
  choices: string[];
  createdAt: string;
}

export function submitChatApproval(
  sessionId: string,
  requestId: string,
  decision: "approve" | "reject",
) {
  return api.post<{ success: boolean }>(
    `/chat/sessions/${sessionId}/approvals/${requestId}`,
    { decision },
  );
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

export async function streamChatMessage(
  sessionId: string,
  text: string,
  options: { useMoa?: boolean; moaPresetId?: string | null },
  onEvent: (event: ChatSseEvent) => void,
) {
  const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      useMoa: options.useMoa ?? false,
      moaPresetId: options.moaPresetId ?? null,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("mymy:unauthorized"));
    }
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = body;
    }
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : response.statusText;
    throw new ApiError(response.status, message, parsed);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("stream response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) onEvent(event);
    }
  }

  if (buffer.trim()) {
    const event = parseSseFrame(buffer);
    if (event) onEvent(event);
  }
}

function parseSseFrame(frame: string): ChatSseEvent | null {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return JSON.parse(dataLines.join("\n")) as ChatSseEvent;
}

export function useDeleteChatSession(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.delete<{ success: boolean }>(`/chat/sessions/${sessionId}`),
    onSuccess: () => {
      // Invalidate project-scoped (if known) and global session lists.
      if (projectId) {
        qc.invalidateQueries({
          queryKey: ["chat", "sessions", projectId],
        });
      }
      qc.invalidateQueries({ queryKey: ["chat", "sessions", "all"] });
    },
  });
}
