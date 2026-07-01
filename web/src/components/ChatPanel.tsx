import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { streamChatMessage, useChatMessages, type ChatSseEvent } from "@/features/chat/api";
import type { ChatMessage } from "@/types/chat";

interface ChatPanelProps {
  sessionId: string | null;
  /** When true, show the "new session" divider at the top (no prior messages). */
  isNewSession: boolean;
  /** Current agent display name (for header). */
  agentName?: string;
  /** Current agent role (for header). */
  agentRole?: string;
}


export function ChatPanel({
  sessionId,
  isNewSession,
  agentName,
  agentRole,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [streamUserMessage, setStreamUserMessage] = useState<ChatMessage | null>(null);
  const [streamAssistantText, setStreamAssistantText] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useChatMessages(sessionId ?? undefined);

  const messages: ChatMessage[] = data?.messages ?? [];
  const visibleMessages = [
    ...messages,
    ...(streamUserMessage ? [streamUserMessage] : []),
    ...(streamAssistantText
      ? [makeStreamingAssistantMessage(sessionId ?? "", streamAssistantText)]
      : []),
  ];

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages.length, streamAssistantText, isStreaming]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !sessionId || isStreaming) return;
    setText("");
    setIsStreaming(true);
    setStreamError(false);
    setStreamUserMessage(null);
    setStreamAssistantText("");
    setToolEvents([]);

    try {
      await streamChatMessage(sessionId, trimmed, (event) => {
        handleStreamEvent(event, {
          setStreamUserMessage,
          setStreamAssistantText,
          setToolEvents,
        });
      });
      await qc.invalidateQueries({ queryKey: ["chat", "messages", sessionId] });
      await qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
      setStreamUserMessage(null);
      setStreamAssistantText("");
      setToolEvents([]);
    } catch {
      setStreamError(true);
    } finally {
      setIsStreaming(false);
    }
  };

  const initial = agentName?.trim().charAt(0).toUpperCase() ?? "?";

  // No session selected — show a clean, minimal placeholder.
  // The sidebar already has a "New session" button, so we don't duplicate
  // that call-to-action here.
  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--text-faint)]">
          {t("chat.noConversation")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Context header — shows who you're talking to */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-3">
        {/* Agent avatar */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-sm font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {agentName ?? t("chat.defaultAgent")}
          </div>
          {agentRole && (
            <div className="truncate text-xs text-[var(--text-muted)]">
              {agentRole}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
            <span className="text-xs text-[var(--text-muted)]">{t("common.loading")}</span>
          </div>
        )}

        {!isLoading && !isNewSession && messages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-muted)]">{t("chat.empty")}</p>
          </div>
        )}

        {/* New session divider — shown when starting a fresh session */}
        {isNewSession && (
          <SessionDivider label={t("chat.newSessionDivider")} />
        )}

        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {toolEvents.map((event) => (
          <ToolEventRow key={event.id} event={event} />
        ))}

        {/* Typing indicator while waiting for agent response */}
        {isStreaming && !streamAssistantText && (
          <div className="flex items-center gap-2 pl-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
            <span className="text-xs text-[var(--text-muted)]">{t("chat.agentTyping")}</span>
          </div>
        )}

        {/* Error */}
        {streamError && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--status-error)] bg-[var(--surface)] px-3 py-2">
            <AlertCircle className="h-4 w-4 text-[var(--status-error)]" strokeWidth={1.5} />
            <span className="text-xs text-[var(--status-error)]">{t("chat.error")}</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-[var(--status-error)]">{t("chat.error")}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-[var(--border)] px-6 py-3"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
          placeholder={t("chat.inputPlaceholder")}
          rows={1}
          className={cn(
            "max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--border)]",
            "bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]",
            "placeholder:text-[var(--text-faint)]",
            "focus:border-[var(--accent)] focus:outline-none",
            "transition-colors duration-150"
          )}
        />
        <button
          type="submit"
          disabled={!text.trim() || isStreaming}
          className={cn(
            "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
            "transition-colors duration-150",
            text.trim() && !isStreaming
              ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              : "cursor-not-allowed bg-[var(--surface-active)] text-[var(--text-faint)]"
          )}
        >
          {isStreaming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              {t("chat.sending")}
            </>
          ) : (
            <>
              <Send className="h-4 w-4" strokeWidth={1.75} />
              {t("chat.send")}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

/** A single message bubble — user (right, accent) or agent (left, surface). */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-lg px-3.5 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent)] text-white"
            : isTool
              ? "border border-[var(--border)] bg-[var(--bg)] font-mono text-xs text-[var(--text-muted)]"
            : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

interface ToolEvent {
  id: string;
  name: string;
  status: "running" | "done";
  detail: string;
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  return (
    <div className="max-w-[80%] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {event.status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        )}
        <span className="font-medium text-[var(--text)]">{event.name}</span>
        <span>{event.status}</span>
      </div>
      {event.detail && (
        <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[11px]">
          {event.detail}
        </pre>
      )}
    </div>
  );
}

function makeStreamingAssistantMessage(sessionId: string, content: string): ChatMessage {
  return {
    id: "streaming-assistant",
    sessionId,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  };
}

function handleStreamEvent(
  event: ChatSseEvent,
  setters: {
    setStreamUserMessage: (message: ChatMessage | null) => void;
    setStreamAssistantText: Dispatch<SetStateAction<string>>;
    setToolEvents: Dispatch<SetStateAction<ToolEvent[]>>;
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
          name: event.tool_name,
          status: "running",
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
    case "error":
      throw new Error(event.message);
  }
}

/** Horizontal divider marking a new session boundary. */
function SessionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
