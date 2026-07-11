import type { ChatClarifyRequest, ChatSseEvent } from "@/features/chat/api";
import type { ChatMessage, ToolCall } from "@/types/chat";
import type { ToolEvent } from "./types";

export function buildToolCallById(messages: ChatMessage[]): Map<string, ToolCall> {
  const toolCalls = new Map<string, ToolCall>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      toolCalls.set(call.id, call);
    }
  }
  return toolCalls;
}


export function makeStreamingAssistantMessage(sessionId: string, content: string): ChatMessage {
  return {
    id: "streaming-assistant",
    sessionId,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

export interface ChatStreamState {
  userMessage: ChatMessage | null;
  assistantText: string;
  toolEvents: ToolEvent[];
  pendingClarify: ChatClarifyRequest | null;
}

export const initialChatStreamState: ChatStreamState = {
  userMessage: null,
  assistantText: "",
  toolEvents: [],
  pendingClarify: null,
};

export type ChatStreamAction =
  | { type: "event"; event: ChatSseEvent; sessionId: string }
  | { type: "reset" }
  | { type: "clearClarify" };

export function chatStreamReducer(
  state: ChatStreamState,
  action: ChatStreamAction,
): ChatStreamState {
  if (action.type === "reset") return initialChatStreamState;
  if (action.type === "clearClarify") {
    return { ...state, pendingClarify: null };
  }
  const { event, sessionId } = action;
  switch (event.type) {
    case "run_status":
    case "outcome_unknown":
    case "model_turn_started":
    case "checklist_changed":
    case "checkpoint_created":
    case "turn_completed":
    case "context_compressing":
    case "done":
      return state;
    case "user_message":
      return { ...state, userMessage: event.message };
    case "text_delta":
      return { ...state, assistantText: state.assistantText + event.content };
    case "tool_call_start":
      return {
        ...state,
        toolEvents: [
          ...state.toolEvents,
          {
            id: event.call_id,
            sessionId,
            name: event.tool_name,
            status: "running",
            arguments: event.arguments,
            detail: event.arguments,
            resourceKey: event.resource_key ?? undefined,
            cancellation: event.capability?.cancellation,
          },
        ],
      };
    case "tool_call_finish":
      return {
        ...state,
        toolEvents: state.toolEvents.map((item) =>
          item.id === event.call_id
            ? { ...item, status: "done", detail: event.error ?? event.result }
            : item,
        ),
      };
    case "clarify":
      return { ...state, pendingClarify: event.request };
    case "error":
      throw new Error(event.message);
  }
}
