import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Loader2,
  AlertCircle,
  Check,
  CircleHelp,
  Network,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { uploadDriveFiles } from "@/features/drive/api";
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
import { AttachmentTray } from "@/components/chat/attachments";
import {
  appendAttachmentsToMessage,
  hasDraggedFiles,
} from "@/components/chat/attachmentUtils";
import { MessageRow } from "@/components/chat/messages";
import {
  SlashCommandMenu,
  SlashCommandPreview,
} from "@/components/chat/slashCommands";
import {
  buildSlashOptions,
  findExactSlashOption,
  parseSlashState,
  type SlashOption,
} from "@/components/chat/slashCommandUtils";
import { ToolEventRow } from "@/components/chat/toolResults";
import {
  buildToolCallById,
  handleStreamEvent,
  makeStreamingAssistantMessage,
} from "@/components/chat/stream";
import type { ToolEvent } from "@/components/chat/types";
import type { ChatAttachment } from "@/components/chat/types";

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

interface QueuedChatTurn {
  id: string;
  sessionId: string;
  content: string;
  options: {
    useMoa: boolean;
    moaPresetId: string | null;
  };
  createdAt: string;
}

function createQueuedTurnId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint32Array(2);
    cryptoApi.getRandomValues(bytes);
    return `queued-${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
  }
  return `queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentSessionId, setAttachmentSessionId] = useState<string | null>(null);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [streamErrorMessage, setStreamErrorMessage] = useState("");
  const [streamUserMessage, setStreamUserMessage] = useState<ChatMessage | null>(null);
  const [streamAssistantText, setStreamAssistantText] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [editingQueuedTurnId, setEditingQueuedTurnId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
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
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);
  const editingQueuedTurnIdRef = useRef<string | null>(null);
  const qc = useQueryClient();

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
  const activeQueuedTurns = queuedTurns.filter((turn) => turn.sessionId === sessionId);
  const activeAttachments = attachmentSessionId === sessionId ? attachments : [];
  const activeUploadingAttachments =
    attachmentSessionId === sessionId && uploadingAttachments;
  const activeAttachmentError =
    attachmentSessionId === sessionId && attachmentError;
  const activeDragDepth = attachmentSessionId === sessionId ? dragDepth : 0;

  function setQueuedTurnState(next: QueuedChatTurn[]) {
    queuedTurnsRef.current = next;
    setQueuedTurns(next);
  }

  function enqueueTurn(turn: QueuedChatTurn) {
    setQueuedTurnState([...queuedTurnsRef.current, turn]);
  }

  function setQueuedTurnEditState(turnId: string | null, content = "") {
    editingQueuedTurnIdRef.current = turnId;
    setEditingQueuedTurnId(turnId);
    setQueuedEditText(content);
  }

  function dequeueNextTurnBatch(): QueuedChatTurn[] {
    if (editingQueuedTurnIdRef.current) return [];

    const [first] = queuedTurnsRef.current;
    if (!first) return [];

    const batch: QueuedChatTurn[] = [];
    const rest: QueuedChatTurn[] = [];
    let foundDifferentSession = false;

    for (const turn of queuedTurnsRef.current) {
      if (!foundDifferentSession && turn.sessionId === first.sessionId) {
        batch.push(turn);
      } else {
        foundDifferentSession = true;
        rest.push(turn);
      }
    }

    setQueuedTurnState(rest);
    return batch;
  }

  function mergeQueuedTurnBatch(batch: QueuedChatTurn[]): QueuedChatTurn | null {
    const [first] = batch;
    if (!first) return null;
    const last = batch[batch.length - 1] ?? first;

    return {
      id: first.id,
      sessionId: first.sessionId,
      content: batch.map((turn) => turn.content).join("\n\n"),
      options: last.options,
      createdAt: first.createdAt,
    };
  }

  function startQueuedTurnsIfIdle() {
    if (isStreamingRef.current || editingQueuedTurnIdRef.current) return;
    const nextTurn = mergeQueuedTurnBatch(dequeueNextTurnBatch());
    if (nextTurn) {
      void runChatTurn(nextTurn);
    }
  }

  function beginQueuedTurnEdit(turn: QueuedChatTurn) {
    setQueuedTurnEditState(turn.id, turn.content);
  }

  function saveQueuedTurnEdit() {
    const editingId = editingQueuedTurnIdRef.current;
    const content = queuedEditText.trim();
    if (!editingId || !content) return;

    setQueuedTurnState(
      queuedTurnsRef.current.map((turn) =>
        turn.id === editingId ? { ...turn, content } : turn,
      ),
    );
    setQueuedTurnEditState(null);
    startQueuedTurnsIfIdle();
  }

  function cancelQueuedTurnEdit() {
    setQueuedTurnEditState(null);
    startQueuedTurnsIfIdle();
  }

  function cancelQueuedTurn(turnId: string) {
    setQueuedTurnState(queuedTurnsRef.current.filter((turn) => turn.id !== turnId));
    if (editingQueuedTurnIdRef.current === turnId) {
      setQueuedTurnEditState(null);
    }
    startQueuedTurnsIfIdle();
  }

  function updateScrollStickiness() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  async function runChatTurn(turn: QueuedChatTurn) {
    if (isStreamingRef.current) {
      enqueueTurn(turn);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (
      (!trimmed && activeAttachments.length === 0) ||
      !sessionId ||
      activeUploadingAttachments
    ) {
      return;
    }
    const outgoingText = appendAttachmentsToMessage(trimmed, activeAttachments);
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
    setAttachments([]);
    setAttachmentSessionId(null);

    if (isStreamingRef.current) {
      enqueueTurn(turn);
      return;
    }

    await runChatTurn(turn);
  };

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

  async function handleAttachmentFiles(files: FileList | File[]) {
    if (!sessionId) return;
    const targetSessionId = sessionId;
    const selected = Array.from(files).filter((file) => file.size > 0);
    if (selected.length === 0) return;
    setAttachmentSessionId(targetSessionId);
    setUploadingAttachments(true);
    setAttachmentError(false);
    try {
      const targetPath = `/drive/shared/chat-attachments/${targetSessionId}`;
      const uploaded = await uploadDriveFiles(targetPath, selected);
      const nextFiles = uploaded.files.map((file) => ({
        name: file.name,
        path: file.path,
        mimeType: file.mimeType,
        size: file.size,
      }));
      setAttachments((current) =>
        attachmentSessionId === targetSessionId
          ? [...current, ...nextFiles]
          : nextFiles,
      );
      setAttachmentSessionId(targetSessionId);
      inputRef.current?.focus();
    } catch {
      setAttachmentSessionId(targetSessionId);
      setAttachmentError(true);
    } finally {
      setUploadingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDragDepth(0);
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event) || !sessionId) return;
    event.preventDefault();
    setAttachmentSessionId(sessionId);
    setDragDepth((current) => current + 1);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth(0);
    void handleAttachmentFiles(event.dataTransfer.files);
  }

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
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeDragDepth > 0 && (
        <div className="pointer-events-none absolute inset-x-6 bottom-24 z-20 flex justify-center">
          <div className="rounded-md border border-[var(--accent)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)] shadow-lg">
            파일을 놓으면 채팅에 첨부됩니다
          </div>
        </div>
      )}
      {/* Context header — shows who you're talking to */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-3">
        {/* Agent avatar */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)] text-sm font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {agentName ?? t("agents.title")}
          </div>
          {agentRole && (
            <div className="truncate text-xs text-[var(--text-muted)]">
              {agentRole}
            </div>
          )}
        </div>
        {moaPresets.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setUseMoa((current) => !current)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                useMoa
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
              )}
            >
              <Network className="h-3.5 w-3.5" strokeWidth={1.5} />
              MoA
            </button>
            <select
              value={selectedMoaPreset?.id ?? ""}
              onChange={(event) => setSelectedMoaPresetId(event.target.value)}
              disabled={!useMoa}
              className="h-8 max-w-[220px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] disabled:opacity-50"
            >
              {moaPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={updateScrollStickiness}
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
          <MessageRow
            key={msg.id}
            message={msg}
            toolCall={msg.toolCallId ? toolCallById.get(msg.toolCallId) : undefined}
            streaming={msg.id === "streaming-assistant" && activeStreaming}
            onOpenDocument={onOpenDocument}
            onOpenPreview={onOpenPreview}
          />
        ))}

        {activeToolEvents.map((event) => (
          <ToolEventRow
            key={event.id}
            event={event}
            onOpenDocument={onOpenDocument}
            onOpenPreview={onOpenPreview}
          />
        ))}

        {/* Typing indicator while waiting for agent response */}
        {activeStreaming && !activeStreamAssistantText && (
          <div className="flex items-center gap-2 pl-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
            <span className="text-xs text-[var(--text-muted)]">{t("chat.agentTyping")}</span>
          </div>
        )}

        {activeQueuedTurns.map((turn) => (
          <div key={turn.id} className="opacity-70">
            {editingQueuedTurnId === turn.id ? (
              <div className="flex max-w-[920px] items-stretch gap-3">
                <div className="w-1 shrink-0 rounded-full bg-[#8b5cf6]" />
                <div className="min-w-0 flex-1 space-y-2 py-0.5">
                  <textarea
                    value={queuedEditText}
                    onChange={(event) => setQueuedEditText(event.target.value)}
                    rows={Math.min(
                      6,
                      Math.max(2, queuedEditText.split("\n").length),
                    )}
                    className={cn(
                      "max-h-40 min-h-[72px] w-full resize-y rounded-md border border-[var(--border)]",
                      "bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]",
                      "focus:border-[var(--accent)] focus:outline-none",
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                      {t("chat.queued")}
                    </span>
                    <button
                      type="button"
                      onClick={saveQueuedTurnEdit}
                      disabled={!queuedEditText.trim()}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={cancelQueuedTurnEdit}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <MessageRow
                message={{
                  id: `queued-${turn.id}`,
                  sessionId: turn.sessionId,
                  role: "user",
                  content: turn.content,
                  createdAt: turn.createdAt,
                }}
                metaLabel={t("chat.queued")}
                footer={
                  <>
                    <button
                      type="button"
                      onClick={() => beginQueuedTurnEdit(turn)}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={1.75} />
                      {t("chat.editQueued")}
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelQueuedTurn(turn.id)}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
                    >
                      <X className="h-3 w-3" strokeWidth={1.75} />
                      {t("chat.cancelQueued")}
                    </button>
                  </>
                }
              />
            )}
          </div>
        ))}

        {/* Error */}
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
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--border)] px-6 py-3"
      >
        {activePendingClarify && (
          <ClarifyInlinePanel
            request={activePendingClarify}
            answer={clarifyAnswer}
            error={clarifyError}
            submitting={clarifySubmitting}
            onAnswerChange={setClarifyAnswer}
            onSubmitAnswer={(answer) => void submitClarify(answer)}
          />
        )}

        {(activeAttachments.length > 0 ||
          activeUploadingAttachments ||
          activeAttachmentError) && (
            <AttachmentTray
              attachments={activeAttachments}
              uploading={activeUploadingAttachments}
              error={activeAttachmentError}
              onRemove={(path) =>
                setAttachments((current) =>
                  current.filter((attachment) => attachment.path !== path),
                )
              }
            />
          )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) {
                void handleAttachmentFiles(event.currentTarget.files);
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={activeUploadingAttachments}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            title="파일 첨부"
          >
            {activeUploadingAttachments ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          <div className="relative flex-1">
            {slashOptions.length > 0 && !slashState?.hasInstruction && (
              <SlashCommandMenu
                options={slashOptions}
                onSelect={selectSlashOption}
              />
            )}
            {slashPreview && slashState?.hasInstruction && (
              <SlashCommandPreview option={slashPreview} />
            )}
            <textarea
              ref={inputRef}
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
                "max-h-32 min-h-[40px] w-full resize-none rounded-lg border border-[var(--border)]",
                "bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]",
                "placeholder:text-[var(--text-faint)]",
                "focus:border-[var(--accent)] focus:outline-none",
                "transition-colors duration-150"
              )}
            />
          </div>
          <button
            type="submit"
            disabled={
              (!text.trim() && activeAttachments.length === 0) ||
              activeUploadingAttachments
            }
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
              "transition-colors duration-150",
              (text.trim() || activeAttachments.length > 0) &&
                !activeUploadingAttachments
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "cursor-not-allowed bg-[var(--surface-active)] text-[var(--text-faint)]"
            )}
          >
            {activeUploadingAttachments ? (
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
        </div>
      </form>
    </div>
  );
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

function ClarifyInlinePanel({
  request,
  answer,
  error,
  submitting,
  onAnswerChange,
  onSubmitAnswer,
}: {
  request: ChatClarifyRequest;
  answer: string;
  error: boolean;
  submitting: boolean;
  onAnswerChange: (answer: string) => void;
  onSubmitAnswer: (answer: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-3 max-w-[920px] rounded-md border border-[var(--accent)]/40 bg-[var(--surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2.5">
        <CircleHelp className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {t("chat.clarifyTitle")}
          </div>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div className="text-sm text-[var(--text)]">{request.question}</div>
        {request.choices.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {request.choices.map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={submitting}
                onClick={() => onSubmitAnswer(choice)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                {choice}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={answer}
            onChange={(event) => onAnswerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitAnswer(answer);
              }
            }}
            disabled={submitting}
            placeholder={t("chat.clarifyPlaceholder")}
            className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => onSubmitAnswer(answer)}
            disabled={!answer.trim() || submitting}
            className="flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Check className="h-4 w-4" strokeWidth={1.75} />
            )}
            {t("chat.answer")}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("chat.clarifyError")}
          </div>
        )}
      </div>
    </div>
  );
}
