import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/types/chat";
import type { LightweightBrowserSource } from "@/features/drive/components/LightweightBrowserPane";
import { HighlightedCodeBlock } from "../shared/codeHighlight";
import { stripMediaTags } from "../attachments/mediaTags";
import { ToolResultView } from "../toolResults";

/** Rich transcript dependencies stay behind the first assistant/tool row. */
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

export function ToolMessageRow({
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
