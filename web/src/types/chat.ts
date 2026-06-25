


export type MessageRole = "user" | "agent";


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
  createdAt: string;
}
