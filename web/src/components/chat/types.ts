import type { ChatClarifyRequest } from "@/features/chat/api";
import type { ChatMessage } from "@/types/chat";

export interface ChatAttachment {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

export interface ToolEvent {
  id: string;
  sessionId: string;
  name: string;
  status: "running" | "done";
  arguments: string;
  detail: string;
}

export interface ScopedStreamState {
  sessionId: string | null;
  isStreaming: boolean;
  assistantText: string;
  userMessage: ChatMessage | null;
  toolEvents: ToolEvent[];
  error: boolean;
  pendingClarify: ChatClarifyRequest | null;
}
