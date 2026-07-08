import { AlertCircle, Check, CircleHelp, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatClarifyRequest } from "@/features/chat/api";

export function ClarifyInlinePanel({
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
