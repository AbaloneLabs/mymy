import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCall } from "@/types/chat";
import { HighlightedCodeBlock } from "./codeHighlight";
import { MediaTagList } from "./media";
import { stripMediaTags } from "./mediaTags";
import { ToolResultView } from "./toolResults";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";

export function MessageRow({
  message,
  toolCall,
  metaLabel,
  footer,
  streaming = false,
  onOpenDocument,
  onOpenPreview,
}: {
  message: ChatMessage;
  toolCall?: ToolCall;
  metaLabel?: string;
  footer?: ReactNode;
  streaming?: boolean;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
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
        onOpenDocument={onOpenDocument}
        onOpenPreview={onOpenPreview}
      />
    );
  }

  return (
    <div className="flex max-w-[920px] items-stretch gap-3">
      <div className={cn("w-1 shrink-0 rounded-full", barClass)} />
      <div className="min-w-0 flex-1 py-0.5 text-sm leading-relaxed text-[var(--text)]">
        {isAssistant ? (
          <AssistantMarkdown content={message.content} streaming={streaming} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[var(--text)]">
            {message.content}
          </div>
        )}
        <MediaTagList text={message.content} />
        {(metaLabel || footer) && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {metaLabel && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
                {metaLabel}
              </span>
            )}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolMessageRow({
  message,
  toolName,
  toolArguments,
  onOpenDocument,
  onOpenPreview,
}: {
  message: ChatMessage;
  toolName: string;
  toolArguments: string;
  onOpenDocument?: (path: string) => void;
  onOpenPreview?: (source: LightweightBrowserSource) => void;
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
          onOpenDocument={onOpenDocument}
          onOpenPreview={onOpenPreview}
        />
      </div>
    </div>
  );
}

export function AssistantMarkdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const markdown = stripMediaTags(content);
  if (!markdown) return null;
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        components={streaming ? streamingMarkdownComponents : markdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents = buildMarkdownComponents(true);
const streamingMarkdownComponents = buildMarkdownComponents(false);

function buildMarkdownComponents(highlightCode: boolean): Components {
  return {
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
          highlight={highlightCode}
        />
      );
    },
  };
}
