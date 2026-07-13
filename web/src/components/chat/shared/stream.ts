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

/**
 * A single segment in the streaming assistant timeline.
 *
 * The timeline preserves the real arrival order of assistant text and tool
 * calls so that the UI can render an interleaved view (text -> tool -> text
 * -> tool) instead of grouping all text before all tools, which was the
 * previous behaviour caused by storing text and tool events in separate
 * collections.
 */
export type StreamItem =
  | { type: "text"; content: string }
  | { type: "tool"; event: ToolEvent };

/**
 * Build a lightweight `ChatMessage` for a streaming text segment.
 *
 * Each text segment in the timeline gets its own synthetic id so React can
 * reconcile multiple assistant text blocks within a single turn.
 */
export function makeStreamingAssistantMessage(
  sessionId: string,
  content: string,
  id = "streaming-assistant",
): ChatMessage {
  return {
    id,
    sessionId,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

export interface ChatStreamState {
  userMessage: ChatMessage | null;
  timeline: StreamItem[];
  pendingClarify: ChatClarifyRequest | null;
}

export const initialChatStreamState: ChatStreamState = {
  userMessage: null,
  timeline: [],
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
    case "provider_retry_scheduled":
    case "provider_retry_requested":
    case "done":
      return state;
    case "user_message":
      return { ...state, userMessage: event.message };
    case "text_delta": {
      // Merge consecutive text deltas into the trailing text segment so they
      // render as one continuous message block. When a tool call separates
      // two text segments, a new text item is created to preserve the
      // interleaved order.
      const last = state.timeline[state.timeline.length - 1];
      if (last && last.type === "text") {
        const timeline = state.timeline.slice();
        timeline[timeline.length - 1] = {
          type: "text",
          content: last.content + event.content,
        };
        return { ...state, timeline };
      }
      return {
        ...state,
        timeline: [...state.timeline, { type: "text", content: event.content }],
      };
    }
    case "tool_call_start":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            type: "tool",
            event: {
              id: event.call_id,
              sessionId,
              name: event.tool_name,
              status: "running",
              arguments: event.arguments,
              detail: event.arguments,
              resourceKey: event.resource_key ?? undefined,
              cancellation: event.capability?.cancellation,
            },
          },
        ],
      };
    case "tool_call_finish":
      return {
        ...state,
        timeline: state.timeline.map((item) =>
          item.type === "tool" && item.event.id === event.call_id
            ? {
                ...item,
                event: {
                  ...item.event,
                  status: "done" as const,
                  detail: event.error ?? event.result,
                },
              }
            : item,
        ),
      };
    case "clarify":
      return { ...state, pendingClarify: event.request };
    case "error":
      // Transport and provider failures are user-visible run state, not React
      // rendering failures. ChatPanel owns the inline error presentation so a
      // failed model request never trips the route-level asset boundary.
      return state;
  }
}
