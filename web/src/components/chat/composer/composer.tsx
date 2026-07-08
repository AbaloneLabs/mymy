import type { KeyboardEvent, RefObject } from "react";
import { Loader2, Plus, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ChatClarifyRequest } from "@/features/chat/api";
import { AttachmentTray } from "../attachments/attachments";
import { ClarifyInlinePanel } from "../transcript/clarifyPanel";
import {
  SlashCommandMenu,
  SlashCommandPreview,
} from "./slashCommands";
import type { SlashOption, SlashState } from "./slashCommandUtils";
import type { ChatAttachment } from "../shared/types";

export function ChatComposer({
  text,
  attachments,
  uploadingAttachments,
  attachmentError,
  pendingClarify,
  clarifyAnswer,
  clarifyError,
  clarifySubmitting,
  slashOptions,
  slashState,
  slashPreview,
  inputRef,
  fileInputRef,
  onTextChange,
  onSubmitMessage,
  onAttachmentFiles,
  onRemoveAttachment,
  onSelectSlashOption,
  onClarifyAnswerChange,
  onSubmitClarify,
}: {
  text: string;
  attachments: ChatAttachment[];
  uploadingAttachments: boolean;
  attachmentError: boolean;
  pendingClarify: ChatClarifyRequest | null;
  clarifyAnswer: string;
  clarifyError: boolean;
  clarifySubmitting: boolean;
  slashOptions: SlashOption[];
  slashState: SlashState | null;
  slashPreview: SlashOption | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onTextChange: (value: string) => void;
  onSubmitMessage: () => void | Promise<void>;
  onAttachmentFiles: (files: FileList) => void;
  onRemoveAttachment: (path: string) => void;
  onSelectSlashOption: (option: SlashOption) => void;
  onClarifyAnswerChange: (answer: string) => void;
  onSubmitClarify: (answer: string) => void;
}) {
  const { t } = useTranslation();
  const canSubmit =
    (text.trim() || attachments.length > 0) && !uploadingAttachments;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void onSubmitMessage();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmitMessage();
      }}
      className="border-t border-[var(--border)] px-6 py-3"
    >
      {pendingClarify && (
        <ClarifyInlinePanel
          request={pendingClarify}
          answer={clarifyAnswer}
          error={clarifyError}
          submitting={clarifySubmitting}
          onAnswerChange={onClarifyAnswerChange}
          onSubmitAnswer={onSubmitClarify}
        />
      )}

      {(attachments.length > 0 || uploadingAttachments || attachmentError) && (
        <AttachmentTray
          attachments={attachments}
          uploading={uploadingAttachments}
          error={attachmentError}
          onRemove={onRemoveAttachment}
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
              onAttachmentFiles(event.currentTarget.files);
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAttachments}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
          title="파일 첨부"
        >
          {uploadingAttachments ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
        <div className="relative flex-1">
          {slashOptions.length > 0 && !slashState?.hasInstruction && (
            <SlashCommandMenu
              options={slashOptions}
              onSelect={onSelectSlashOption}
            />
          )}
          {slashPreview && slashState?.hasInstruction && (
            <SlashCommandPreview option={slashPreview} />
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.inputPlaceholder")}
            rows={1}
            className={cn(
              "max-h-32 min-h-[40px] w-full resize-none rounded-lg border border-[var(--border)]",
              "bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]",
              "placeholder:text-[var(--text-faint)]",
              "focus:border-[var(--accent)] focus:outline-none",
              "transition-colors duration-150",
            )}
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium",
            "transition-colors duration-150",
            canSubmit
              ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              : "cursor-not-allowed bg-[var(--surface-active)] text-[var(--text-faint)]",
          )}
        >
          {uploadingAttachments ? (
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
  );
}
