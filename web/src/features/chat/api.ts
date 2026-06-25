/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ChatMessage, ChatSession } from "@/types/chat";

/* -------------------------------------------------- Chat */

interface ChatSessionsResponse {
  sessions: ChatSession[];
}
interface ChatMessagesResponse {
  messages: ChatMessage[];
}
interface SendMessageResponse {
  userMessage: ChatMessage;
  agentMessage: ChatMessage;
  session: ChatSession;
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
        profile: vars.profile ?? "default",
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

export function useSendMessage(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api.post<SendMessageResponse>(
        `/chat/sessions/${sessionId}/messages`,
        { text },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["chat", "messages", sessionId],
      });
      qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
  });
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
