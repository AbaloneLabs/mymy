import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  streamChatMessage,
  submitChatClarifyAnswer,
  useChatMessages,
  type ChatClarifyRequest,
} from "@/features/chat/api";
import { useNativeSkills, useSkillBundles } from "@/features/skills/api";
import { useMoaPresets } from "@/features/moa/api";
import type { ChatMessage } from "@/types/chat";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import { appendAttachmentsToMessage } from "@/components/chat/attachments/attachmentUtils";
import { ChatComposer } from "@/components/chat/composer/composer";
import { ChatHeader } from "@/components/chat/shared/header";
import { ChatTranscript } from "@/components/chat/transcript/transcript";
import {
  buildSlashOptions,
  findExactSlashOption,
  parseSlashState,
  type SlashOption,
} from "@/components/chat/composer/slashCommandUtils";
import {
  buildToolCallById,
  handleStreamEvent,
  makeStreamingAssistantMessage,
} from "@/components/chat/shared/stream";
import {
  createQueuedTurnId,
  useQueuedChatTurns,
} from "@/components/chat/queue/useQueuedChatTurns";
import { useChatAttachments } from "@/components/chat/attachments/useChatAttachments";
import type {
  QueuedChatTurn,
  ToolEvent,
} from "@/components/chat/shared/types";

interface ChatPanelProps {
  sessionId: string | null;
  /** When true, show the "new session" divider at the top (no prior messages). */
  isNewSession: boolean;
  /** Current agent display name (for header). */
  agentName?: string;
  /** Current agent role (for header). */
  agentRole?: string;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
}

export function ChatPanel({
  sessionId,
  isNewSession,
  agentName,
  agentRole,
  onOpenDocument,
  onOpenPreview,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [streamErrorMessage, setStreamErrorMessage] = useState("");
  const [streamUserMessage, setStreamUserMessage] = useState<ChatMessage | null>(null);
  const [streamAssistantText, setStreamAssistantText] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pendingClarify, setPendingClarify] = useState<ChatClarifyRequest | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [clarifyError, setClarifyError] = useState(false);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [useMoa, setUseMoa] = useState(false);
  const [selectedMoaPresetId, setSelectedMoaPresetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);
  const isStreamingRef = useRef(false);
  const qc = useQueryClient();
  const queuedTurnsState = useQueuedChatTurns();
  const attachmentState = useChatAttachments({
    sessionId,
    inputRef,
    fileInputRef,
  });

  const { data, isLoading, isError } = useChatMessages(sessionId ?? undefined);
  const { data: nativeSkillsData } = useNativeSkills();
  const { data: skillBundlesData } = useSkillBundles();
  const { data: moaPresetsData } = useMoaPresets();

  const messages: ChatMessage[] = useMemo(
    () => (data?.messages ?? []).filter((message) => message.sessionId === sessionId),
    [data?.messages, sessionId],
  );
  const moaPresets = (moaPresetsData?.presets ?? []).filter(
    (preset) => preset.enabled,
  );
  const selectedMoaPreset =
    moaPresets.find((preset) => preset.id === selectedMoaPresetId) ??
    moaPresets[0] ??
    null;
  const slashState = parseSlashState(text);
  const slashOptions = slashState
    ? buildSlashOptions(
        skillBundlesData?.bundles ?? [],
        nativeSkillsData?.skills ?? [],
        slashState.query,
      )
    : [];
  const slashPreview = slashState
    ? findExactSlashOption(
        skillBundlesData?.bundles ?? [],
        nativeSkillsData?.skills ?? [],
        slashState.command,
      )
    : null;
  const activeStreaming = isStreaming && streamSessionId === sessionId;
  const activeStreamAssistantText = activeStreaming ? streamAssistantText : "";
  const activeStreamError = streamError && streamSessionId === sessionId;
  const activeStreamErrorMessage = activeStreamError ? streamErrorMessage : "";
  const activeToolEvents = toolEvents.filter((event) => event.sessionId === sessionId);
  const activePendingClarify =
    pendingClarify?.sessionId === sessionId ? pendingClarify : null;

  const visibleMessages = useMemo(() => {
    const messageIds = new Set(messages.map((message) => message.id));
    const scopedStreamUserMessage =
      streamUserMessage &&
      streamUserMessage.sessionId === sessionId &&
      !messageIds.has(streamUserMessage.id)
        ? streamUserMessage
        : null;
    return [
      ...messages,
      ...(scopedStreamUserMessage ? [scopedStreamUserMessage] : []),
      ...(activeStreamAssistantText
        ? [makeStreamingAssistantMessage(sessionId ?? "", activeStreamAssistantText)]
        : []),
    ];
  }, [activeStreamAssistantText, messages, sessionId, streamUserMessage]);
  const toolCallById = useMemo(
    () => buildToolCallById(visibleMessages),
    [visibleMessages],
  );
  const activeQueuedTurns = queuedTurnsState.queuedTurns.filter(
    (turn) => turn.sessionId === sessionId,
  );
  function startQueuedTurnsIfIdle() {
    if (isStreamingRef.current) return;
    const nextTurn = queuedTurnsState.dequeueNextMergedTurn();
    if (nextTurn) {
      void runChatTurn(nextTurn);
    }
  }

  function beginQueuedTurnEdit(turn: QueuedChatTurn) {
    queuedTurnsState.beginQueuedTurnEdit(turn);
  }

  function saveQueuedTurnEdit() {
    if (queuedTurnsState.saveQueuedTurnEdit()) {
      startQueuedTurnsIfIdle();
    }
  }

  function cancelQueuedTurnEdit() {
    queuedTurnsState.cancelQueuedTurnEdit();
    startQueuedTurnsIfIdle();
  }

  function cancelQueuedTurn(turnId: string) {
    queuedTurnsState.cancelQueuedTurn(turnId);
    startQueuedTurnsIfIdle();
  }

  function updateScrollStickiness() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  async function runChatTurn(turn: QueuedChatTurn) {
    if (isStreamingRef.current) {
      queuedTurnsState.enqueueTurn(turn);
      return;
    }

    isStreamingRef.current = true;
    setIsStreaming(true);
    setStreamSessionId(turn.sessionId);
    setStreamError(false);
    setStreamErrorMessage("");
    setStreamUserMessage(null);
    setStreamAssistantText("");
    setToolEvents([]);
    setPendingClarify(null);
    setClarifyAnswer("");
    setClarifyError(false);
    setClarifySubmitting(false);

    try {
      await streamChatMessage(
        turn.sessionId,
        turn.content,
        turn.options,
        (event) => {
          handleStreamEvent(event, turn.sessionId, {
            setStreamUserMessage,
            setStreamAssistantText,
            setToolEvents,
            setPendingClarify,
          });
        },
      );
      await qc.invalidateQueries({ queryKey: ["chat", "messages", turn.sessionId] });
      await qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
      setStreamUserMessage(null);
      setStreamAssistantText("");
      setStreamSessionId(null);
      setToolEvents([]);
    } catch (error) {
      setStreamError(true);
      setStreamErrorMessage(error instanceof Error ? error.message : "");
    } finally {
      isStreamingRef.current = false;
      setIsStreaming(false);
      startQueuedTurnsIfIdle();
    }
  }

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      const frame = window.requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    visibleMessages.length,
    activeStreamAssistantText,
    activeStreaming,
    activeQueuedTurns.length,
  ]);

  useEffect(() => {
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [sessionId]);

  async function submitCurrentMessage() {
    const trimmed = text.trim();
    if (
      (!trimmed && attachmentState.activeAttachments.length === 0) ||
      !sessionId ||
      attachmentState.activeUploadingAttachments
    ) {
      return;
    }
    const outgoingText = appendAttachmentsToMessage(
      trimmed,
      attachmentState.activeAttachments,
    );
    const turn: QueuedChatTurn = {
      id: createQueuedTurnId(),
      sessionId,
      content: outgoingText,
      options: {
        useMoa: useMoa && Boolean(selectedMoaPreset),
        moaPresetId: selectedMoaPreset?.id ?? null,
      },
      createdAt: new Date().toISOString(),
    };

    setText("");
    attachmentState.clearAttachments();

    if (isStreamingRef.current) {
      queuedTurnsState.enqueueTurn(turn);
      return;
    }

    await runChatTurn(turn);
  }

  const submitClarify = async (answer: string) => {
    if (!pendingClarify) return;
    const trimmed = answer.trim();
    if (!trimmed) return;
    setClarifySubmitting(true);
    setClarifyError(false);
    try {
      await submitChatClarifyAnswer(
        pendingClarify.sessionId,
        pendingClarify.requestId,
        trimmed,
      );
      setPendingClarify(null);
      setClarifyAnswer("");
    } catch {
      setClarifyError(true);
    } finally {
      setClarifySubmitting(false);
    }
  };

  function selectSlashOption(option: SlashOption) {
    setText(`/${option.name} `);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

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
    <div
      className="relative flex h-full flex-col"
      onDragEnter={attachmentState.handleDragEnter}
      onDragOver={attachmentState.handleDragOver}
      onDragLeave={attachmentState.handleDragLeave}
      onDrop={attachmentState.handleDrop}
    >
      {attachmentState.activeDragDepth > 0 && (
        <div className="pointer-events-none absolute inset-x-6 bottom-24 z-20 flex justify-center">
          <div className="rounded-md border border-[var(--accent)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] shadow-lg">
            파일을 놓으면 채팅에 첨부됩니다
          </div>
        </div>
      )}
      <ChatHeader
        agentName={agentName}
        agentRole={agentRole}
        moaPresets={moaPresets}
        selectedMoaPreset={selectedMoaPreset}
        useMoa={useMoa}
        onUseMoaChange={setUseMoa}
        onMoaPresetChange={setSelectedMoaPresetId}
      />

      <div
        ref={scrollRef}
        onScroll={updateScrollStickiness}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
      >
        <ChatTranscript
          isLoading={isLoading}
          isError={isError}
          isNewSession={isNewSession}
          messageCount={messages.length}
          visibleMessages={visibleMessages}
          toolCallById={toolCallById}
          activeStreaming={activeStreaming}
          activeStreamAssistantText={activeStreamAssistantText}
          activeStreamError={activeStreamError}
          activeStreamErrorMessage={activeStreamErrorMessage}
          activeToolEvents={activeToolEvents}
          activeQueuedTurns={activeQueuedTurns}
          editingQueuedTurnId={queuedTurnsState.editingQueuedTurnId}
          queuedEditText={queuedTurnsState.queuedEditText}
          onOpenDocument={onOpenDocument}
          onOpenPreview={onOpenPreview}
          onQueuedEditTextChange={queuedTurnsState.setQueuedEditText}
          onBeginQueuedTurnEdit={beginQueuedTurnEdit}
          onSaveQueuedTurnEdit={saveQueuedTurnEdit}
          onCancelQueuedTurnEdit={cancelQueuedTurnEdit}
          onCancelQueuedTurn={cancelQueuedTurn}
        />
      </div>

      <ChatComposer
        text={text}
        attachments={attachmentState.activeAttachments}
        uploadingAttachments={attachmentState.activeUploadingAttachments}
        attachmentError={attachmentState.activeAttachmentError}
        pendingClarify={activePendingClarify}
        clarifyAnswer={clarifyAnswer}
        clarifyError={clarifyError}
        clarifySubmitting={clarifySubmitting}
        slashOptions={slashOptions}
        slashState={slashState}
        slashPreview={slashPreview}
        inputRef={inputRef}
        fileInputRef={fileInputRef}
        onTextChange={setText}
        onSubmitMessage={submitCurrentMessage}
        onAttachmentFiles={(files) =>
          void attachmentState.handleAttachmentFiles(files)
        }
        onRemoveAttachment={attachmentState.removeAttachment}
        onSelectSlashOption={selectSlashOption}
        onClarifyAnswerChange={setClarifyAnswer}
        onSubmitClarify={(answer) => void submitClarify(answer)}
      />
    </div>
  );
}
