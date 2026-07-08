import type { Dispatch, SetStateAction } from "react";
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

export function handleStreamEvent(
  event: ChatSseEvent,
  sessionId: string,
  setters: {
    setStreamUserMessage: (message: ChatMessage | null) => void;
    setStreamAssistantText: Dispatch<SetStateAction<string>>;
    setToolEvents: Dispatch<SetStateAction<ToolEvent[]>>;
    setPendingClarify: Dispatch<SetStateAction<ChatClarifyRequest | null>>;
  },
) {
  switch (event.type) {
    case "user_message":
      setters.setStreamUserMessage(event.message);
      break;
    case "text_delta":
      setters.setStreamAssistantText((current) => current + event.content);
      break;
    case "tool_call_start":
      setters.setToolEvents((current) => [
        ...current,
        {
          id: event.call_id,
          sessionId,
          name: event.tool_name,
          status: "running",
          arguments: event.arguments,
          detail: event.arguments,
        },
      ]);
      break;
    case "tool_call_finish":
      setters.setToolEvents((current) =>
        current.map((item) =>
          item.id === event.call_id
            ? { ...item, status: "done", detail: event.error ?? event.result }
            : item,
        ),
      );
      break;
    case "clarify":
      setters.setPendingClarify(event.request);
      break;
    case "error":
      throw new Error(event.message);
  }
}
