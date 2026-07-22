import { lazy, Suspense } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import type { ChatMessage, ToolCall } from "@/types/chat";
import { MessageRow } from "./messages";
import { QueuedTurnCard } from "../queue/queuedTurns";
import { SessionDivider } from "./sessionDivider";
import { makeStreamingAssistantMessage, type StreamItem } from "../shared/stream";
import type { QueuedChatTurn } from "../shared/types";
import { TranscriptItemBoundary } from "../shared/TranscriptItemBoundary";

const ToolEventRow = lazy(() =>
  import("../toolResults").then((module) => ({ default: module.ToolEventRow })),
);

interface ChatTranscriptProps {
  isLoading: boolean;
  isError: boolean;
  isNewSession: boolean;
  messageCount: number;
  visibleMessages: ChatMessage[];
  toolCallById: Map<string, ToolCall>;
  activeStreaming: boolean;
  activeTimeline: StreamItem[];
  activeStreamError: boolean;
  activeStreamErrorMessage: string;
  activeQueuedTurns: QueuedChatTurn[];
  editingQueuedTurnId: string | null;
  queuedEditText: string;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
  onQueuedEditTextChange: (text: string) => void;
  onBeginQueuedTurnEdit: (turn: QueuedChatTurn) => void;
  onSaveQueuedTurnEdit: () => void;
  onCancelQueuedTurnEdit: () => void;
  onCancelQueuedTurn: (turnId: string) => void;
}

export function ChatTranscript({
  isLoading,
  isError,
  isNewSession,
  messageCount,
  visibleMessages,
  toolCallById,
  activeStreaming,
  activeTimeline,
  activeStreamError,
  activeStreamErrorMessage,
  activeQueuedTurns,
  editingQueuedTurnId,
  queuedEditText,
  onOpenDocument,
  onOpenPreview,
  onQueuedEditTextChange,
  onBeginQueuedTurnEdit,
  onSaveQueuedTurnEdit,
  onCancelQueuedTurnEdit,
  onCancelQueuedTurn,
}: ChatTranscriptProps) {
  const { t } = useTranslation();

  return (
    <>
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
          <span className="text-xs text-[var(--text-muted)]">{t("common.loading")}</span>
        </div>
      )}

      {!isLoading && !isNewSession && messageCount === 0 && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-[var(--text-muted)]">{t("chat.empty")}</p>
        </div>
      )}

      {isNewSession && (
        <SessionDivider label={t("chat.newSessionDivider")} />
      )}

      {visibleMessages.map((msg) => (
        <MessageRow
          key={msg.id}
          message={msg}
          toolCall={msg.toolCallId ? toolCallById.get(msg.toolCallId) : undefined}
          onOpenDocument={onOpenDocument}
          onOpenPreview={onOpenPreview}
        />
      ))}

      {/* Streaming timeline: render text and tool segments interleaved in
          their real arrival order so the user sees text -> tool -> text ->
          tool as it happens, instead of all text followed by all tools. */}
      {activeTimeline.map((item, index) => {
        if (item.type === "tool") {
          const event = item.event;
          return (
            <TranscriptItemBoundary
              key={`tool-${event.id}-${index}`}
              itemId={`${event.id}:${event.status}`}
              fallback={
                <div className="whitespace-pre-wrap break-words text-xs text-[var(--text-muted)]">
                  {event.detail}
                </div>
              }
            >
              <Suspense fallback={<div className="text-xs text-[var(--text-muted)]">…</div>}>
                <ToolEventRow
                  event={event}
                  onOpenDocument={onOpenDocument}
                  onOpenPreview={onOpenPreview}
                />
              </Suspense>
            </TranscriptItemBoundary>
          );
        }
        // Text segment: the last text segment is the one still streaming.
        const isLastText =
          index === activeTimeline.length - 1 || activeTimeline[index + 1].type !== "text";
        return (
          <MessageRow
            key={`stream-text-${index}`}
            message={makeStreamingAssistantMessage("", item.content, `stream-text-${index}`)}
            streaming={isLastText && activeStreaming}
            onOpenDocument={onOpenDocument}
            onOpenPreview={onOpenPreview}
          />
        );
      })}

      {activeStreaming && activeTimeline.length === 0 && (
        <div className="flex items-center gap-2 pl-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
          <span className="text-xs text-[var(--text-muted)]">{t("chat.agentTyping")}</span>
        </div>
      )}

      {activeQueuedTurns.map((turn) => (
        <div key={turn.id} className="opacity-70">
          <QueuedTurnCard
            turn={turn}
            editing={editingQueuedTurnId === turn.id}
            editText={queuedEditText}
            onEditTextChange={onQueuedEditTextChange}
            onBeginEdit={onBeginQueuedTurnEdit}
            onSaveEdit={onSaveQueuedTurnEdit}
            onCancelEdit={onCancelQueuedTurnEdit}
            onCancelTurn={onCancelQueuedTurn}
          />
        </div>
      ))}

      {activeStreamError && (
        <div className="rounded-md border border-[var(--status-error)] bg-[var(--surface)] px-3 py-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-[var(--status-error)]" strokeWidth={1.5} />
            <span className="text-xs text-[var(--status-error)]">{t("chat.error")}</span>
          </div>
          {activeStreamErrorMessage && (
            <div className="mt-1 break-words pl-6 text-xs text-[var(--text-muted)]">
              {activeStreamErrorMessage}
            </div>
          )}
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center py-8">
          <span className="text-xs text-[var(--status-error)]">{t("chat.error")}</span>
        </div>
      )}
    </>
  );
}
