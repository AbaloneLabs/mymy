import { lazy, Suspense, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCall } from "@/types/chat";
import { MediaTagList } from "../attachments/media";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import { TranscriptItemBoundary } from "../shared/TranscriptItemBoundary";

const AssistantMarkdown = lazy(() =>
  import("./richMessages").then((module) => ({
    default: module.AssistantMarkdown,
  })),
);
const ToolMessageRow = lazy(() =>
  import("./richMessages").then((module) => ({
    default: module.ToolMessageRow,
  })),
);

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
      <TranscriptItemBoundary
        itemId={message.id}
        fallback={<RichMessageFallback content={message.content} />}
      >
        <Suspense fallback={<RichMessageFallback content={message.content} />}>
          <ToolMessageRow
            message={message}
            toolName={toolCall?.name ?? "tool"}
            toolArguments={toolCall?.arguments ?? "{}"}
            onOpenDocument={onOpenDocument}
            onOpenPreview={onOpenPreview}
          />
        </Suspense>
      </TranscriptItemBoundary>
    );
  }

  return (
    <div className="flex max-w-[920px] items-stretch gap-3">
      <div className={cn("w-1 shrink-0 rounded-full", barClass)} />
      <div className="min-w-0 flex-1 py-0.5 text-sm leading-relaxed text-[var(--text)]">
        {isAssistant ? (
          <TranscriptItemBoundary
            itemId={message.id}
            fallback={<RichMessageFallback content={message.content} />}
          >
            <Suspense fallback={<RichMessageFallback content={message.content} />}>
              <AssistantMarkdown content={message.content} streaming={streaming} />
            </Suspense>
          </TranscriptItemBoundary>
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

function RichMessageFallback({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[var(--text)]">
      {content}
    </div>
  );
}
