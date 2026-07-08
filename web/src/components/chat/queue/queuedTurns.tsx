import { Check, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MessageRow } from "../transcript/messages";
import type { QueuedChatTurn } from "../shared/types";

export function QueuedTurnCard({
  turn,
  editing,
  editText,
  onEditTextChange,
  onBeginEdit,
  onSaveEdit,
  onCancelEdit,
  onCancelTurn,
}: {
  turn: QueuedChatTurn;
  editing: boolean;
  editText: string;
  onEditTextChange: (value: string) => void;
  onBeginEdit: (turn: QueuedChatTurn) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onCancelTurn: (turnId: string) => void;
}) {
  const { t } = useTranslation();

  if (editing) {
    return (
      <div className="flex max-w-[920px] items-stretch gap-3">
        <div className="w-1 shrink-0 rounded-full bg-[#8b5cf6]" />
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <textarea
            value={editText}
            onChange={(event) => onEditTextChange(event.target.value)}
            rows={Math.min(6, Math.max(2, editText.split("\n").length))}
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
              onClick={onSaveEdit}
              disabled={!editText.trim()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
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
            onClick={() => onBeginEdit(turn)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Pencil className="h-3 w-3" strokeWidth={1.75} />
            {t("chat.editQueued")}
          </button>
          <button
            type="button"
            onClick={() => onCancelTurn(turn.id)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--status-error)]"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
            {t("chat.cancelQueued")}
          </button>
        </>
      }
    />
  );
}
