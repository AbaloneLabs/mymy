import {
  Check,
  Command,
  Download,
  Keyboard,
  Loader2,
  Redo2,
  Save,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function DocumentEditorSideHeader({
  name,
  path,
  onClose,
}: {
  name: string | null;
  path: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--text)]">
          {name ?? t("documentEditor.title")}
        </div>
        <div className="truncate font-mono text-[10px] text-[var(--text-faint)]">
          {path}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title={t("common.close")}
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function DocumentEditorToolbar({
  dirty,
  lastSavedAt,
  isSaving,
  isSaveQueued,
  canUndo,
  canRedo,
  findPanelOpen,
  onToggleShortcutHelp,
  onOpenCommandPalette,
  onUndo,
  onRedo,
  onDownloadPackage,
  onToggleFindPanel,
  onSave,
}: {
  dirty: boolean;
  lastSavedAt: string | null;
  isSaving: boolean;
  isSaveQueued: boolean;
  canUndo: boolean;
  canRedo: boolean;
  findPanelOpen: boolean;
  onToggleShortcutHelp: () => void;
  onOpenCommandPalette: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownloadPackage: () => void;
  onToggleFindPanel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-4 py-2">
      <button
        type="button"
        onClick={onToggleShortcutHelp}
        className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        title={t("documentEditor.shortcuts", { defaultValue: "Shortcuts" })}
      >
        <Keyboard className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.shortcuts", { defaultValue: "Shortcuts" })}
      </button>
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title={t("documentEditor.commandPalette", {
          defaultValue: "Command palette",
        })}
      >
        <Command className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.undo", { defaultValue: "Undo" })}
      >
        <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.redo", { defaultValue: "Redo" })}
      >
        <Redo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDownloadPackage}
        disabled={isSaving}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("drive.downloadPackage")}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onToggleFindPanel}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
          findPanelOpen && "border-[var(--accent)] text-[var(--accent)]",
        )}
        title={t("documentEditor.find", { defaultValue: "Find" })}
      >
        <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {dirty && (
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {isSaveQueued
            ? t("documentEditor.saveQueued", { defaultValue: "Save queued" })
            : t("documentEditor.unsaved")}
        </span>
      )}
      {lastSavedAt && !dirty && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          <Check className="h-3 w-3" strokeWidth={1.75} />
          {t("documentEditor.savedAt", { time: lastSavedAt })}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || isSaving}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        {t("common.save")}
      </button>
    </div>
  );
}
