import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
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
  const qc = useQueryClient();

  const { data, isLoading, isError } = useChatMessages(sessionId ?? undefined);
  const { data: nativeSkillsData } = useNativeSkills();
  const { data: skillBundlesData } = useSkillBundles();
  const { data: moaPresetsData } = useMoaPresets();

  const messages: ChatMessage[] = data?.messages ?? [];
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
        trimmed,
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

      {pendingApproval && (
        <ApprovalDialog
          request={pendingApproval}
          error={approvalError}
          submitting={approvalSubmitting}
          onApprove={() => void submitApproval("approve")}
          onReject={() => void submitApproval("reject")}
        />
      )}

      {pendingClarify && (
        <ClarifyDialog
          request={pendingClarify}
          answer={clarifyAnswer}
          error={clarifyError}
          submitting={clarifySubmitting}
          onAnswerChange={setClarifyAnswer}
          onSubmitAnswer={(answer) => void submitClarify(answer)}
        />
      )}
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
        <MediaTagList text={message.content} />
      </div>
    </div>
  );
}

type SlashOption = {
  type: "bundle" | "skill";
  name: string;
  description: string;
  skills: string[];
};

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
  if (event.name === "execute_code") {
    return <CodeExecutionEvent event={event} />;
  }

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
        <>
          <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[11px]">
            {event.detail}
          </pre>
          <MediaTagList text={event.detail} />
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
    <div className="max-w-[92%] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
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
      {code && (
        <CodeBlock title="script.py" content={code} highlighted />
      )}
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
  highlighted = false,
  tone,
}: {
  title: string;
  content: string;
  highlighted?: boolean;
  tone?: "error";
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--border)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px] text-[var(--text-faint)]">
        <Code2 className="h-3 w-3" strokeWidth={1.5} />
        {title}
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto bg-[var(--surface)] p-2 font-mono text-[11px] leading-relaxed",
          tone === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
        )}
      >
        {highlighted ? <HighlightedPython value={content} /> : content}
      </pre>
    </div>
  );
}

function HighlightedPython({ value }: { value: string }) {
  return (
    <>
      {value.split("\n").map((line, lineIndex) => (
        <span key={lineIndex}>
          {highlightPythonLine(line)}
          {lineIndex < value.split("\n").length - 1 ? "\n" : ""}
        </span>
      ))}
    </>
  );
}

function highlightPythonLine(line: string) {
  const tokens = line.split(/(\b(?:async|await|class|def|for|from|if|import|in|return|while|with|try|except|raise|print)\b|#[^\n]*|"[^"]*"|'[^']*')/g);
  return tokens.map((token, index) => {
    if (!token) return null;
    if (token.startsWith("#")) {
      return <span key={index} className="text-[var(--text-faint)]">{token}</span>;
    }
    if (token.startsWith("\"") || token.startsWith("'")) {
      return <span key={index} className="text-[var(--accent)]">{token}</span>;
    }
    if (/^\b(?:async|await|class|def|for|from|if|import|in|return|while|with|try|except|raise|print)\b$/.test(token)) {
      return <span key={index} className="font-semibold text-[var(--text)]">{token}</span>;
    }
    return token;
  });
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
  const src = `${API_BASE}/media?path=${encodeURIComponent(path)}`;
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

function ApprovalDialog({
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
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
        <div className="space-y-3 px-4 py-4">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
              {t("chat.approvalReason")}
            </div>
            <div className="text-sm text-[var(--text)]">{request.description}</div>
          </div>
          <pre className="max-h-52 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
            {request.command}
          </pre>
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-[var(--status-error)] bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
              <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
              {t("chat.approvalError")}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onReject}
            disabled={isSubmitting}
            className="flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
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
            className="flex h-9 items-center gap-2 rounded-md bg-[var(--status-error)] px-3 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
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
    </div>
  );
}

function ClarifyDialog({
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <CircleHelp className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--text)]">
              {t("chat.clarifyTitle")}
            </div>
          </div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="text-sm text-[var(--text)]">{request.question}</div>
          {request.choices.length > 0 && (
            <div className="grid gap-2">
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
    </div>
  );
}
