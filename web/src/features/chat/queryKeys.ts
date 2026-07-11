/** Stable cache identities shared by chat facades and views. */
export const chatQueryKeys = {
  sessionsRoot: ["chat", "sessions"] as const,
  sessions: (projectId?: string, profile?: string) =>
    ["chat", "sessions", projectId ?? "all", profile ?? "all"] as const,
  sessionScope: (projectId?: string) =>
    ["chat", "sessions", projectId ?? "all"] as const,
  messages: (sessionId?: string) => ["chat", "messages", sessionId] as const,
  runtime: (sessionId?: string | null) => ["chat", "runtime", sessionId] as const,
  runs: (filters: object = {}) => ["agent-runs", filters] as const,
  eventLog: (runId?: string) => ["agent-runs", runId, "event-log"] as const,
  checklist: (runId?: string) => ["agent-runs", runId, "checklist"] as const,
};
