import { useCallback, useMemo, useState } from "react";
import type { ChatSession } from "@/types/chat";

const CHAT_SESSIONS_COLLAPSED_KEY = "mymy:chat-sessions-collapsed";

export function resolveEffectiveChatSessionId(
  sessions: ReadonlyArray<Pick<ChatSession, "id">>,
  requestedSessionId: string | null,
  activeSessionId: string | null,
): string | null {
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (requestedSessionId && sessionIds.has(requestedSessionId)) {
    return requestedSessionId;
  }
  if (activeSessionId && sessionIds.has(activeSessionId)) {
    return activeSessionId;
  }
  return sessions[0]?.id ?? null;
}

export function useChatSessionSelection(
  sessions: ChatSession[],
  requestedSessionId: string | null,
) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isNewSession, setIsNewSession] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHAT_SESSIONS_COLLAPSED_KEY) === "true";
  });

  const effectiveSessionId = resolveEffectiveChatSessionId(
    sessions,
    requestedSessionId,
    activeSessionId,
  );
  const effectiveSession = useMemo(
    () => sessions.find((session) => session.id === effectiveSessionId),
    [effectiveSessionId, sessions],
  );

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setIsNewSession(false);
  }, []);

  const markCreatedSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setIsNewSession(true);
  }, []);

  const markDeletedSession = useCallback(
    (sessionId: string) => {
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
      setIsNewSession(false);
    },
    [activeSessionId],
  );

  const toggleSessionsCollapsed = useCallback(() => {
    setSessionsCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CHAT_SESSIONS_COLLAPSED_KEY, String(next));
      }
      return next;
    });
  }, []);

  return {
    activeSessionId,
    effectiveSessionId,
    effectiveSession,
    isNewSession,
    sessionsCollapsed,
    selectSession,
    markCreatedSession,
    markDeletedSession,
    toggleSessionsCollapsed,
  };
}
