


export type MessageRole = "user" | "assistant" | "tool" | "system";


export type SessionStatus = "active" | "archived";


export interface ChatSession {
  id: string;

  projectId?: string;

  hermesSessionId?: string;

  agentId: string;

  profile: string;

  title?: string;
  status: SessionStatus;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}


export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  metadata?: unknown;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
