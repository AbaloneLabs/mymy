import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  AlertCircle,
  ShieldAlert,
  Check,
  X,
  CircleHelp,
  Boxes,
  Code2,
  Puzzle,
  Terminal,
  Network,
  Search,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { driveBlobUrl, uploadDriveFiles } from "@/features/drive/api";
import {
  streamChatMessage,
  submitChatApproval,
  submitChatClarifyAnswer,
  useChatMessages,
  type ChatApprovalRequest,
  type ChatClarifyRequest,
  type ChatSseEvent,
} from "@/features/chat/api";
import {
  type NativeSkill,
  type SkillBundle,
  useNativeSkills,
  useSkillBundles,
} from "@/features/skills/api";
import { useMoaPresets } from "@/features/moa/api";
import type { ChatMessage, ToolCall } from "@/types/chat";

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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentSessionId, setAttachmentSessionId] = useState<string | null>(null);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [streamUserMessage, setStreamUserMessage] = useState<ChatMessage | null>(null);
  const [streamAssistantText, setStreamAssistantText] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ChatApprovalRequest | null>(null);
  const [approvalError, setApprovalError] = useState(false);
  const [approvalSubmitting, setApprovalSubmitting] = useState<"approve" | "reject" | null>(null);
  const [pendingClarify, setPendingClarify] = useState<ChatClarifyRequest | null>(null);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [clarifyError, setClarifyError] = useState(false);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [useMoa, setUseMoa] = useState(false);
  const [selectedMoaPresetId, setSelectedMoaPresetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useChatMessages(sessionId ?? undefined);
  const { data: nativeSkillsData } = useNativeSkills();
  const { data: skillBundlesData } = useSkillBundles();
  const { data: moaPresetsData } = useMoaPresets();

  const messages: ChatMessage[] = useMemo(
    () => data?.messages ?? [],
    [data?.messages],
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
      ...(streamAssistantText && streamSessionId === sessionId
        ? [makeStreamingAssistantMessage(sessionId ?? "", streamAssistantText)]
        : []),
    ];
  }, [messages, sessionId, streamAssistantText, streamSessionId, streamUserMessage]);
  const toolCallById = useMemo(
    () => buildToolCallById(visibleMessages),
    [visibleMessages],
  );
  const activeAttachments = attachmentSessionId === sessionId ? attachments : [];
  const activeUploadingAttachments =
    attachmentSessionId === sessionId && uploadingAttachments;
  const activeAttachmentError =
    attachmentSessionId === sessionId && attachmentError;
  const activeDragDepth = attachmentSessionId === sessionId ? dragDepth : 0;

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
    if (
      (!trimmed && activeAttachments.length === 0) ||
      !sessionId ||
      isStreaming ||
      activeUploadingAttachments
    ) {
      return;
    }
    const outgoingText = appendAttachmentsToMessage(trimmed, activeAttachments);
    setText("");
    setAttachments([]);
    setAttachmentSessionId(null);
    setIsStreaming(true);
    setStreamSessionId(sessionId);
    setStreamError(false);
    setStreamUserMessage(null);
    setStreamAssistantText("");
    setToolEvents([]);
    setPendingApproval(null);
    setApprovalError(false);
    setApprovalSubmitting(null);
    setPendingClarify(null);
    setClarifyAnswer("");
    setClarifyError(false);
    setClarifySubmitting(false);

    try {
      await streamChatMessage(
        sessionId,
        outgoingText,
        {
          useMoa: useMoa && Boolean(selectedMoaPreset),
          moaPresetId: selectedMoaPreset?.id ?? null,
        },
        (event) => {
          handleStreamEvent(event, {
            setStreamUserMessage,
            setStreamAssistantText,
            setToolEvents,
            setPendingApproval,
            setPendingClarify,
          });
        },
      );
      await qc.invalidateQueries({ queryKey: ["chat", "messages", sessionId] });
      await qc.invalidateQueries({ queryKey: ["chat", "sessions"] });
      setStreamUserMessage(null);
      setStreamAssistantText("");
      setStreamSessionId(null);
      setToolEvents([]);
    } catch {
      setStreamError(true);
    } finally {
      setIsStreaming(false);
    }
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

  const submitApproval = async (decision: "approve" | "reject") => {
    if (!pendingApproval) return;
    setApprovalSubmitting(decision);
    setApprovalError(false);
    try {
      await submitChatApproval(
        pendingApproval.sessionId,
        pendingApproval.requestId,
        decision,
      );
      setPendingApproval(null);
    } catch {
      setApprovalError(true);
    } finally {
      setApprovalSubmitting(null);
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
          />
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
        className="border-t border-[var(--border)] px-6 py-3"
      >
        {pendingApproval && (
          <ApprovalInlinePanel
            request={pendingApproval}
            error={approvalError}
            submitting={approvalSubmitting}
            onApprove={() => void submitApproval("approve")}
            onReject={() => void submitApproval("reject")}
          />
        )}

        {pendingClarify && (
          <ClarifyInlinePanel
            request={pendingClarify}
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
            disabled={activeUploadingAttachments || isStreaming}
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
              isStreaming ||
              activeUploadingAttachments
            }
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
              "transition-colors duration-150",
              (text.trim() || activeAttachments.length > 0) &&
                !isStreaming &&
                !activeUploadingAttachments
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
        </div>
      </form>
    </div>
  );
}

function MessageRow({
  message,
  toolCall,
}: {
  message: ChatMessage;
  toolCall?: ToolCall;
}) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isAssistant = message.role === "assistant";
  const barClass = isUser
    ? "bg-[#8b5cf6]"
    : isAssistant
      ? "bg-[#a3e635]"
      : "bg-[var(--border-hover)]";

  if (isTool) {
    return (
      <ToolMessageRow
        message={message}
        toolName={toolCall?.name ?? "tool"}
        toolArguments={toolCall?.arguments ?? "{}"}
      />
    );
  }

  return (
    <div className="flex max-w-[920px] items-stretch gap-3">
      <div className={cn("w-1 shrink-0 rounded-full", barClass)} />
      <div className="min-w-0 flex-1 py-0.5 text-sm leading-relaxed text-[var(--text)]">
        {isAssistant ? (
          <AssistantMarkdown content={message.content} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[var(--text)]">
            {message.content}
          </div>
        )}
        <MediaTagList text={message.content} />
      </div>
    </div>
  );
}

function ToolMessageRow({
  message,
  toolName,
  toolArguments,
}: {
  message: ChatMessage;
  toolName: string;
  toolArguments: string;
}) {
  return (
    <div className="flex max-w-[920px] items-stretch gap-3">
      <div className="w-1 shrink-0 rounded-full bg-[var(--border-hover)]" />
      <div className="min-w-0 flex-1">
        <ToolResultView
          name={toolName}
          status="done"
          argumentsText={toolArguments}
          detail={message.content}
        />
      </div>
    </div>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  const markdown = stripMediaTags(content);
  if (!markdown) return null;
  return (
    <div className="chat-markdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-([\w-]+)/.exec(className ?? "");
    if (!match) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <HighlightedCodeBlock
        code={String(children).replace(/\n$/, "")}
        language={match[1]}
      />
    );
  },
};

type SlashOption = {
  type: "bundle" | "skill";
  name: string;
  description: string;
  skills: string[];
};

interface ChatAttachment {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

function AttachmentTray({
  attachments,
  uploading,
  error,
  onRemove,
}: {
  attachments: ChatAttachment[];
  uploading: boolean;
  error: boolean;
  onRemove: (path: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.path}
          className="inline-flex max-w-[280px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-muted)]"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-[var(--text)]">
            {attachment.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
            {formatAttachmentSize(attachment.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(attachment.path)}
            className="shrink-0 rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
            title="첨부 제거"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      ))}
      {uploading && (
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          업로드 중
        </span>
      )}
      {error && (
        <span className="text-xs text-[var(--status-error)]">
          파일을 업로드하지 못했습니다.
        </span>
      )}
      {attachments.length > 0 && !uploading && !error && (
        <span className="text-xs text-[var(--text-faint)]">
          {attachments.length}개 파일 첨부됨
        </span>
      )}
    </div>
  );
}

function SlashCommandMenu({
  options,
  onSelect,
}: {
  options: SlashOption[];
  onSelect: (option: SlashOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
      {options.map((option) => {
        const Icon = option.type === "bundle" ? Boxes : Puzzle;
        return (
          <button
            key={`${option.type}:${option.name}`}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option)}
            className="flex w-full items-start gap-2 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)]"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-[var(--text)]">
                  /{option.name}
                </span>
                <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {option.type === "bundle" ? t("chat.slashBundle") : t("chat.slashSkill")}
                </span>
              </span>
              {option.description && (
                <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SlashCommandPreview({ option }: { option: SlashOption }) {
  const { t } = useTranslation();
  if (option.type !== "bundle" || option.skills.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span>{t("chat.slashPreview")}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {option.skills.map((skill) => (
          <span
            key={skill}
            className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseSlashState(text: string) {
  const rest = text.trimStart();
  if (!rest.startsWith("/")) return null;
  const body = rest.slice(1);
  const commandEnd = body.search(/\s/);
  const command = commandEnd >= 0 ? body.slice(0, commandEnd) : body;
  return {
    command,
    query: slugify(command),
    hasInstruction: commandEnd >= 0,
  };
}

function buildSlashOptions(
  bundles: SkillBundle[],
  skills: NativeSkill[],
  query: string,
): SlashOption[] {
  const options: SlashOption[] = [
    ...bundles.map((bundle) => ({
      type: "bundle" as const,
      name: bundle.name,
      description: bundle.description,
      skills: bundle.skills,
    })),
    ...skills.map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      description: skill.description,
      skills: [],
    })),
  ];
  return options
    .filter((option) => {
      if (!query) return true;
      return slugify(option.name).includes(query);
    })
    .slice(0, 6);
}

function findExactSlashOption(
  bundles: SkillBundle[],
  skills: NativeSkill[],
  command: string,
): SlashOption | null {
  if (!command) return null;
  const query = slugify(command);
  return (
    buildSlashOptions(bundles, skills, "")
      .find((option) => slugify(option.name) === query) ?? null
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._\-\s/]+/g, "")
    .trim()
    .replace(/[\s/_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface ToolEvent {
  id: string;
  name: string;
  status: "running" | "done";
  arguments: string;
  detail: string;
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  return (
    <ToolResultView
      name={event.name}
      status={event.status}
      argumentsText={event.arguments}
      detail={event.detail}
    />
  );
}

function ToolResultView({
  name,
  status,
  argumentsText,
  detail,
}: {
  name: string;
  status: "running" | "done";
  argumentsText: string;
  detail: string;
}) {
  if (name === "execute_code") {
    return (
      <CodeExecutionEvent
        event={{ id: name, name, status, arguments: argumentsText, detail }}
      />
    );
  }

  if (name === "web_search") {
    const searchResult = parseWebSearchResult(detail);
    if (searchResult) {
      return <WebSearchResultPanel result={searchResult} status={status} />;
    }
  }

  if (name === "web_extract") {
    const extractResult = parseWebExtractResult(detail);
    if (extractResult) {
      return <WebExtractResultPanel result={extractResult} status={status} />;
    }
  }

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        )}
        <span className="font-medium text-[var(--text)]">{name}</span>
        <span>{status}</span>
      </div>
      {detail && (
        <>
          <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[11px]">
            {detail}
          </pre>
          <MediaTagList text={detail} />
        </>
      )}
    </div>
  );
}

function CodeExecutionEvent({ event }: { event: ToolEvent }) {
  const request = parseJsonObject(event.arguments);
  const result = parseJsonObject(event.detail);
  const code = typeof request?.code === "string" ? request.code : "";
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const exitCode =
    typeof result?.exit_code === "number" ? result.exit_code : undefined;
  const cwd = typeof result?.cwd === "string" ? result.cwd : undefined;
  const success = typeof result?.success === "boolean" ? result.success : undefined;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {event.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Terminal className="h-3 w-3" strokeWidth={1.5} />
        )}
        <span className="font-medium text-[var(--text)]">execute_code</span>
        {success !== undefined && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] uppercase",
              success
                ? "bg-[var(--status-success,#22c55e)]/10 text-[var(--status-success,#22c55e)]"
                : "bg-[var(--status-error)]/10 text-[var(--status-error)]",
            )}
          >
            {success ? "ok" : "failed"}
          </span>
        )}
        {exitCode !== undefined && <span>exit {exitCode}</span>}
      </div>
      {cwd && (
        <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {cwd}
        </div>
      )}
      {code && <CodeBlock title="script.py" content={code} language="python" />}
      {stdout && <CodeBlock title="stdout" content={stdout} />}
      {stderr && <CodeBlock title="stderr" content={stderr} tone="error" />}
      {!result && event.detail && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface)] p-2 font-mono text-[11px]">
          {event.detail}
        </pre>
      )}
    </div>
  );
}

function CodeBlock({
  title,
  content,
  language,
  tone,
}: {
  title: string;
  content: string;
  language?: string;
  tone?: "error";
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--border)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px] text-[var(--text-faint)]">
        <Code2 className="h-3 w-3" strokeWidth={1.5} />
        {title}
      </div>
      <HighlightedCodeBlock
        code={content}
        language={language ?? languageFromTitle(title)}
        tone={tone}
        compact
      />
    </div>
  );
}

function HighlightedCodeBlock({
  code,
  language,
  tone,
  compact = false,
}: {
  code: string;
  language?: string;
  tone?: "error";
  compact?: boolean;
}) {
  const highlightKey = `${language ?? "text"}:${code}`;
  const [highlight, setHighlight] = useState<{ key: string; html: string } | null>(null);

  useEffect(() => {
    let active = true;
    const lang = normalizeCodeLanguage(language);

    void renderHighlightedCode(code, lang)
      .then((rendered) => {
        if (active) setHighlight({ key: highlightKey, html: rendered });
      })
      .catch(() => {
        if (active) setHighlight(null);
      });

    return () => {
      active = false;
    };
  }, [code, highlightKey, language]);

  if (highlight?.key === highlightKey) {
    return (
      <div
        className={cn(
          "shiki-code-block",
          compact ? "max-h-64" : "my-2 max-h-80",
        )}
        dangerouslySetInnerHTML={{ __html: highlight.html }}
      />
    );
  }

  return (
    <pre
      className={cn(
        "overflow-auto bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed",
        compact ? "max-h-64" : "my-2 max-h-80 rounded-md border border-[var(--border)]",
        tone === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

type ChatHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
};

const SHIKI_THEME = "github-dark";
const SUPPORTED_SHIKI_LANGUAGES = new Set([
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "rust",
  "shellscript",
  "sql",
  "tsx",
  "typescript",
  "yaml",
]);

let chatHighlighterPromise: Promise<ChatHighlighter> | null = null;

function getChatHighlighter(): Promise<ChatHighlighter> {
  chatHighlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-dark.mjs"),
    import("shiki/langs/bash.mjs"),
    import("shiki/langs/css.mjs"),
    import("shiki/langs/html.mjs"),
    import("shiki/langs/javascript.mjs"),
    import("shiki/langs/json.mjs"),
    import("shiki/langs/jsx.mjs"),
    import("shiki/langs/markdown.mjs"),
    import("shiki/langs/python.mjs"),
    import("shiki/langs/rust.mjs"),
    import("shiki/langs/shellscript.mjs"),
    import("shiki/langs/sql.mjs"),
    import("shiki/langs/tsx.mjs"),
    import("shiki/langs/typescript.mjs"),
    import("shiki/langs/yaml.mjs"),
  ]).then(
    ([
      core,
      engine,
      theme,
      bash,
      css,
      html,
      javascript,
      json,
      jsx,
      markdown,
      python,
      rust,
      shellscript,
      sql,
      tsx,
      typescript,
      yaml,
    ]) =>
      core.createHighlighterCore({
        themes: [theme.default],
        langs: [
          ...bash.default,
          ...css.default,
          ...html.default,
          ...javascript.default,
          ...json.default,
          ...jsx.default,
          ...markdown.default,
          ...python.default,
          ...rust.default,
          ...shellscript.default,
          ...sql.default,
          ...tsx.default,
          ...typescript.default,
          ...yaml.default,
        ],
        engine: engine.createJavaScriptRegexEngine(),
      }),
  );
  return chatHighlighterPromise;
}

async function renderHighlightedCode(code: string, language: string): Promise<string> {
  const highlighter = await getChatHighlighter();
  const lang = SUPPORTED_SHIKI_LANGUAGES.has(language) ? language : "text";
  return highlighter.codeToHtml(code, { lang, theme: SHIKI_THEME });
}

function normalizeCodeLanguage(language?: string): string {
  const normalized = (language ?? "text").toLowerCase();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    plaintext: "text",
    txt: "text",
  };
  return aliases[normalized] ?? normalized;
}

function languageFromTitle(title: string): string {
  const extension = title.split(".").pop()?.toLowerCase();
  if (!extension || extension === title) return "text";
  return normalizeCodeLanguage(extension);
}

interface WebSearchResult {
  query: string;
  results: WebSearchItem[];
}

interface WebSearchItem {
  title: string;
  url: string;
  content: string;
}

function WebSearchResultPanel({
  result,
  status,
}: {
  result: WebSearchResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleResults = expanded ? result.results : result.results.slice(0, 3);
  const hiddenCount = Math.max(result.results.length - visibleResults.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Search className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.webSearchTitle")}
        </span>
        <span>
          {t("chat.webSearchResultCount", { count: result.results.length })}
        </span>
      </div>
      {result.query && (
        <div className="mt-1 break-words text-sm text-[var(--text)]">
          {result.query}
        </div>
      )}
      <div className="mt-2 grid gap-2">
        {visibleResults.map((item, index) => (
          <WebSearchResultItem key={`${item.url}:${index}`} item={item} />
        ))}
      </div>
      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showMoreResults", { count: hiddenCount })}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function WebSearchResultItem({ item }: { item: WebSearchItem }) {
  const host = hostnameFromUrl(item.url);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium text-[var(--text)]">
            {item.title || item.url}
          </div>
          {host && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
              {host}
            </div>
          )}
        </div>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label="Open result"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
        )}
      </div>
      {item.content && (
        <div className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-[var(--text-muted)]">
          {item.content}
        </div>
      )}
    </div>
  );
}

interface WebExtractResult {
  url: string;
  status?: number;
  text: string;
}

function WebExtractResultPanel({
  result,
  status,
}: {
  result: WebExtractResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = expanded ? result.text : truncateText(result.text, 1200);
  const canExpand = result.text.length > text.length;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <FileText className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.webExtractTitle")}
        </span>
        {result.status !== undefined && (
          <span>{t("chat.httpStatus", { status: result.status })}</span>
        )}
      </div>
      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate font-mono text-[10px] text-[var(--accent-hover)] hover:underline"
        >
          {result.url}
        </a>
      )}
      {text && (
        <div className="mt-2 whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
          {text}
        </div>
      )}
      {canExpand || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showMore")}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function parseWebSearchResult(value: string): WebSearchResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const results = parsed.results;
  if (!Array.isArray(results)) return null;

  return {
    query: typeof parsed.query === "string" ? parsed.query : "",
    results: results
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        url: typeof item.url === "string" ? item.url : "",
        content: typeof item.content === "string" ? item.content : "",
      }))
      .filter((item) => item.title || item.url || item.content),
  };
}

function parseWebExtractResult(value: string): WebExtractResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const url = typeof parsed.url === "string" ? parsed.url : "";
  const status = typeof parsed.status === "number" ? parsed.status : undefined;
  if (!text && !url) return null;
  return { url, status, text };
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function appendAttachmentsToMessage(text: string, attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return text;
  const lines = attachments.map((attachment) => {
    const mediaTag = isPreviewableAttachment(attachment)
      ? ` MEDIA:${attachment.path}`
      : "";
    return `- ${attachment.name} (${attachment.mimeType || "file"}, ${formatAttachmentSize(attachment.size)}): ${attachment.path}${mediaTag}`;
  });
  return [
    text,
    "",
    "첨부 파일:",
    ...lines,
  ]
    .filter((_, index) => text || index > 1)
    .join("\n");
}

function hasDraggedFiles(event: React.DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isPreviewableAttachment(attachment: ChatAttachment) {
  return (
    attachment.mimeType.startsWith("image/") ||
    attachment.mimeType.startsWith("audio/") ||
    attachment.mimeType.startsWith("video/")
  );
}

function formatAttachmentSize(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let amount = size;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function buildToolCallById(messages: ChatMessage[]): Map<string, ToolCall> {
  const toolCalls = new Map<string, ToolCall>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      toolCalls.set(call.id, call);
    }
  }
  return toolCalls;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function MediaTagList({ text }: { text: string }) {
  const tags = extractMediaTags(text);
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {tags.map((path) => (
        <MediaPreview key={path} path={path} />
      ))}
    </div>
  );
}

function MediaPreview({ path }: { path: string }) {
  const src = path.startsWith("/drive/")
    ? driveBlobUrl(path)
    : `${API_BASE}/media?path=${encodeURIComponent(path)}`;
  const kind = mediaKind(path);
  if (kind === "audio") {
    return <audio controls src={src} className="w-full" />;
  }
  if (kind === "video") {
    return (
      <video
        controls
        src={src}
        className="max-h-80 w-full rounded-md border border-[var(--border)]"
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="max-h-80 rounded-md border border-[var(--border)] object-contain"
    />
  );
}

function extractMediaTags(text: string): string[] {
  const matches = text.matchAll(/MEDIA:([^\s"',}\]]+)/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

function stripMediaTags(text: string): string {
  return text
    .replace(/MEDIA:([^\s"',}\]]+)/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function mediaKind(path: string): "image" | "audio" | "video" {
  const lower = path.toLowerCase();
  if (/\.(mp3|wav)$/.test(lower)) return "audio";
  if (/\.(mp4|webm)$/.test(lower)) return "video";
  return "image";
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
    setPendingApproval: Dispatch<SetStateAction<ChatApprovalRequest | null>>;
    setPendingClarify: Dispatch<SetStateAction<ChatClarifyRequest | null>>;
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
          arguments: event.arguments,
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
    case "approval_required":
      setters.setPendingApproval(event.request);
      break;
    case "clarify":
      setters.setPendingClarify(event.request);
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

function ApprovalInlinePanel({
  request,
  error,
  submitting,
  onApprove,
  onReject,
}: {
  request: ChatApprovalRequest;
  error: boolean;
  submitting: "approve" | "reject" | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const isSubmitting = submitting !== null;

  return (
    <div className="mb-3 max-w-[920px] rounded-md border border-[var(--status-error)]/40 bg-[var(--surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2.5">
        <ShieldAlert className="h-4 w-4 text-[var(--status-error)]" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text)]">
            {t("chat.approvalTitle")}
          </div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {request.toolName} · {request.patternKey}
          </div>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            {t("chat.approvalReason")}
          </div>
          <div className="text-sm text-[var(--text)]">{request.description}</div>
        </div>
        <pre className="max-h-40 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
          {request.command}
        </pre>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
            <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("chat.approvalError")}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-3 py-2.5">
        <button
          type="button"
          onClick={onReject}
          disabled={isSubmitting}
          className="flex h-8 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {submitting === "reject" ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <X className="h-4 w-4" strokeWidth={1.75} />
          )}
          {t("chat.rejectApproval")}
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="flex h-8 items-center gap-2 rounded-md bg-[var(--status-error)] px-3 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {submitting === "approve" ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Check className="h-4 w-4" strokeWidth={1.75} />
          )}
          {t("chat.approve")}
        </button>
      </div>
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
