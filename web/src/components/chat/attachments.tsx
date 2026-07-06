import { Loader2, Paperclip, Trash2 } from "lucide-react";
import { formatAttachmentSize } from "./attachmentUtils";
import type { ChatAttachment } from "./types";

export function AttachmentTray({
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
