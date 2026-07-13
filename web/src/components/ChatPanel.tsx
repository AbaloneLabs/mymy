import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  cancelAgentRun,
  cancelQueuedChatInput,
  enqueueChatMessage,
  observeAgentRun,
  retryAgentRun,
  submitChatClarifyAnswer,
  updateQueuedChatInput,
  useChatMessages,
  useSessionRuntime,
  useRunChecklist,
  type AgentRunStatus,
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
  chatStreamReducer,
  initialChatStreamState,
  type StreamItem,
} from "@/components/chat/shared/stream";
import { createQueuedTurnId } from "@/components/chat/queue/useQueuedChatTurns";
import { chatQueryKeys } from "@/features/chat/queryKeys";
import { RunStatusCard } from "@/components/chat/runtime/runStatusCard";
import { useChatAttachments } from "@/components/chat/attachments/useChatAttachments";
import type { QueuedChatTurn } from "@/components/chat/shared/types";

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
  const [chatStream, dispatchChatStream] = useReducer(
    chatStreamReducer,
    initialChatStreamState,
  );
  const streamUserMessage = chatStream.userMessage;
  const timeline = chatStream.timeline;
  const pendingClarify = chatStream.pendingClarify;
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [clarifyError, setClarifyError] = useState(false);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [observedRunId, setObservedRunId] = useState<string | null>(null);
  const [observedRunStatus, setObservedRunStatus] = useState<AgentRunStatus | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [editingQueuedTurnId, setEditingQueuedTurnId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
  const [useMoa, setUseMoa] = useState(false);
  const [selectedMoaPresetId, setSelectedMoaPresetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);
  const isStreamingRef = useRef(false);
  const observedRunIdRef = useRef<string | null>(null);
  const runObserverRef = useRef<AbortController | null>(null);
  const runCursorsRef = useRef(new Map<string, number>());
  const qc = useQueryClient();
  const attachmentState = useChatAttachments({
    sessionId,
    inputRef,
    fileInputRef,
  });

  const { data, isLoading, isError } = useChatMessages(sessionId ?? undefined);
  const { data: runtimeData } = useSessionRuntime(sessionId ?? undefined);
  const { data: checklistData } = useRunChecklist(observedRunId ?? undefined);
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
  const observedRuntimeRun =
    runtimeData?.activeRun?.id === observedRunId ? runtimeData.activeRun : null;
  const providerRetryScheduled =
    observedRuntimeRun?.errorCode === "provider_retry_scheduled" &&
    Boolean(observedRuntimeRun.nextAttemptAt);
  const displayedRunStatus = observedRuntimeRun?.status ?? observedRunStatus;
  const activeStreaming =
    isStreaming && streamSessionId === sessionId && !providerRetryScheduled;
  const activeStreamError = streamError && streamSessionId === sessionId;
  const activeStreamErrorMessage = activeStreamError ? streamErrorMessage : "";
  // Only surface timeline items that belong to the currently visible session.
  const activeTimeline: StreamItem[] = activeStreaming
    ? timeline.filter(
        (item) =>
          item.type === "text" ||
          (item.type === "tool" && item.event.sessionId === sessionId),
      )
    : [];
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
    return [...messages, ...(scopedStreamUserMessage ? [scopedStreamUserMessage] : [])];
  }, [messages, sessionId, streamUserMessage]);
  const toolCallById = useMemo(
    () => buildToolCallById(visibleMessages),
    [visibleMessages],
  );
  const activeQueuedTurns = useMemo(
    () =>
      (runtimeData?.queuedInputs ?? [])
        .filter(
          (input) =>
            input.sessionId === sessionId &&
            input.status === "queued" &&
            input.targetRunId !== observedRunId,
        )
        .map((input): QueuedChatTurn => {
          const options = input.options as {
            useMoa?: unknown;
            moaPresetId?: unknown;
          };
          return {
            id: input.id,
            sessionId: input.sessionId,
            content: input.content,
            options: {
              useMoa: options.useMoa === true,
              moaPresetId:
                typeof options.moaPresetId === "string"
                  ? options.moaPresetId
                  : null,
            },
            createdAt: input.createdAt,
          };
        }),
    [observedRunId, runtimeData?.queuedInputs, sessionId],
  );

  function beginQueuedTurnEdit(turn: QueuedChatTurn) {
    setEditingQueuedTurnId(turn.id);
    setQueuedEditText(turn.content);
  }

  async function saveQueuedTurnEdit() {
    const content = queuedEditText.trim();
    if (!editingQueuedTurnId || !content) return;
    await updateQueuedChatInput(editingQueuedTurnId, content);
    setEditingQueuedTurnId(null);
    setQueuedEditText("");
    await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(sessionId) });
  }

  function cancelQueuedTurnEdit() {
    setEditingQueuedTurnId(null);
    setQueuedEditText("");
  }

  async function cancelQueuedTurn(turnId: string) {
    await cancelQueuedChatInput(turnId);
    if (editingQueuedTurnId === turnId) cancelQueuedTurnEdit();
    await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(sessionId) });
  }

  function updateScrollStickiness() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  const observeRun = useCallback(async (runId: string, runSessionId: string) => {
    if (isStreamingRef.current || observedRunIdRef.current === runId) return;
    isStreamingRef.current = true;
    observedRunIdRef.current = runId;
    const controller = new AbortController();
    runObserverRef.current = controller;
    setIsStreaming(true);
    setStreamSessionId(runSessionId);
    setObservedRunId(runId);
    setObservedRunStatus("queued");
    setCancelRequested(false);
    setOutcomeUnknown(false);
    setStreamError(false);
    setStreamErrorMessage("");
    dispatchChatStream({ type: "reset" });
    setClarifyAnswer("");
    setClarifyError(false);
    setClarifySubmitting(false);

    try {
      const result = await observeAgentRun(
        runId,
        runCursorsRef.current.get(runId) ?? 0,
        (event) => {
          if (event.type === "run_status") {
            setObservedRunStatus(event.status);
            setCancelRequested(event.cancel_requested);
          }
          if (event.type === "outcome_unknown") {
            setOutcomeUnknown(true);
          }
          if (event.type === "error") {
            setStreamError(true);
            setStreamErrorMessage(event.message);
          }
          dispatchChatStream({ type: "event", event, sessionId: runSessionId });
        },
        controller.signal,
      );
      runCursorsRef.current.set(runId, result.cursor);
      setObservedRunStatus(result.run.status);
      await qc.invalidateQueries({ queryKey: chatQueryKeys.messages(runSessionId) });
      await qc.invalidateQueries({ queryKey: chatQueryKeys.sessionsRoot });
      await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(runSessionId) });
      dispatchChatStream({ type: "reset" });
    } catch (error) {
      if (!controller.signal.aborted) {
        setStreamError(true);
        setStreamErrorMessage(error instanceof Error ? error.message : "");
      }
    } finally {
      if (observedRunIdRef.current === runId) {
        observedRunIdRef.current = null;
        runObserverRef.current = null;
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    }
  }, [qc]);

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
    activeTimeline.length,
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

  useEffect(() => {
    runObserverRef.current?.abort();
    runObserverRef.current = null;
    observedRunIdRef.current = null;
    isStreamingRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || isStreamingRef.current) return;
    const candidateRunId =
      runtimeData?.activeRun?.id ??
      runtimeData?.queuedInputs.find(
        (input) => input.status !== "cancelled" && Boolean(input.targetRunId),
      )?.targetRunId;
    if (candidateRunId) {
      void observeRun(candidateRunId, sessionId);
    }
  }, [observeRun, runtimeData?.activeRun?.id, runtimeData?.queuedInputs, sessionId]);

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
    setText("");
    attachmentState.clearAttachments();
    try {
      const enqueued = await enqueueChatMessage(
        sessionId,
        createQueuedTurnId(),
        outgoingText,
        {
          useMoa: useMoa && Boolean(selectedMoaPreset),
          moaPresetId: selectedMoaPreset?.id ?? null,
        },
      );
      await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(sessionId) });
      if (!isStreamingRef.current && enqueued.run) {
        void observeRun(enqueued.run.id, sessionId);
      }
    } catch (error) {
      setText(outgoingText);
      setStreamError(true);
      setStreamSessionId(sessionId);
      setStreamErrorMessage(error instanceof Error ? error.message : "");
    }
  }

  async function stopObservedRun() {
    if (!observedRunId) return;
    const response = await cancelAgentRun(observedRunId);
    if (response.accepted) setCancelRequested(true);
    await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(sessionId) });
  }

  async function retryObservedRun() {
    if (!observedRunId) return;
    setRetryingRunId(observedRunId);
    setStreamError(false);
    setStreamErrorMessage("");
    try {
      const response = await retryAgentRun(observedRunId);
      setObservedRunStatus(response.run.status);
      await qc.invalidateQueries({ queryKey: chatQueryKeys.runtime(sessionId) });
    } catch (error) {
      setStreamError(true);
      setStreamErrorMessage(error instanceof Error ? error.message : "");
    } finally {
      setRetryingRunId(null);
    }
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
      dispatchChatStream({ type: "clearClarify" });
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
          activeTimeline={activeTimeline}
          activeStreamError={activeStreamError}
          activeStreamErrorMessage={activeStreamErrorMessage}
          activeQueuedTurns={activeQueuedTurns}
          editingQueuedTurnId={editingQueuedTurnId}
          queuedEditText={queuedEditText}
          onOpenDocument={onOpenDocument}
          onOpenPreview={onOpenPreview}
          onQueuedEditTextChange={setQueuedEditText}
          onBeginQueuedTurnEdit={beginQueuedTurnEdit}
          onSaveQueuedTurnEdit={() => void saveQueuedTurnEdit()}
          onCancelQueuedTurnEdit={cancelQueuedTurnEdit}
          onCancelQueuedTurn={(turnId) => void cancelQueuedTurn(turnId)}
        />
        {observedRunId && displayedRunStatus && streamSessionId === sessionId && (
          <RunStatusCard
            runId={observedRunId}
            objective={observedRuntimeRun?.objective}
            status={displayedRunStatus}
            cancelling={cancelRequested}
            outcomeUnknown={outcomeUnknown}
            retryAt={observedRuntimeRun?.nextAttemptAt}
            retryCount={observedRuntimeRun?.providerRetryCount}
            retrying={retryingRunId === observedRunId}
            waitingForFirstOutput={activeStreaming && activeTimeline.length === 0}
            checklist={checklistData?.items ?? []}
            onStop={() => void stopObservedRun()}
            onRetry={() => void retryObservedRun()}
          />
        )}
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
