import { useCallback, useMemo, useState } from "react";
import type { ChatSession } from "@/types/chat";

const CHAT_SESSIONS_COLLAPSED_KEY = "mymy:chat-sessions-collapsed";

export function useChatSessionSelection(sessions: ChatSession[]) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isNewSession, setIsNewSession] = useState(false);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHAT_SESSIONS_COLLAPSED_KEY) === "true";
  });

  const sessionIds = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  );
  const activeSessionIsVisible =
    activeSessionId !== null && sessionIds.has(activeSessionId);
  const effectiveSessionId = activeSessionIsVisible
    ? activeSessionId
    : sessions[0]?.id ?? null;
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
