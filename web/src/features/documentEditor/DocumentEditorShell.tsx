import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertTriangle,
  Check,
  Command,
  Download,
  Keyboard,
  Loader2,
  Redo2,
  Replace,
  Save,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  editorCommandsForKind,
  type EditorCommandDefinition,
  type EditorCommandId,
} from "@/features/documentEditor/commands";
import type {
  DocumentCompatibilityWarning,
  DocumentEditorKind,
} from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

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

export function DocumentEditorStatusBar({
  kind,
  model,
  fingerprint,
  dirty,
  isSaving,
  isSaveQueued,
  warningCount,
}: {
  kind: DocumentEditorKind;
  model: unknown;
  fingerprint: string;
  dirty: boolean;
  isSaving: boolean;
  isSaveQueued: boolean;
  warningCount: number;
}) {
  const { t } = useTranslation();
  const statusItems = documentEditorStatusItems(kind, model);
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[11px] text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">
        {documentEditorKindLabel(kind)}
      </span>
      <span>
        {isSaving
          ? t("documentEditor.saving", { defaultValue: "Saving" })
          : isSaveQueued
            ? t("documentEditor.saveQueued", { defaultValue: "Save queued" })
            : dirty
            ? t("documentEditor.unsaved")
            : t("documentEditor.saved", { defaultValue: "Saved" })}
      </span>
      <span className="font-mono text-[var(--text-faint)]">
        {t("documentEditor.revision", { defaultValue: "rev" })}{" "}
        {fingerprint.slice(0, 10)}
      </span>
      {warningCount > 0 && (
        <span className="text-[var(--status-warning)]">
          {t("documentEditor.compatibilityWarningCount", {
            defaultValue: "{{count}} compatibility warnings",
            count: warningCount,
          })}
        </span>
      )}
      {statusItems.map((item) => (
        <span key={item} className="truncate">
          {item}
        </span>
      ))}
    </div>
  );
}

export function CommandPalette({
  kind,
  keymap,
  query,
  onQueryChange,
  onRun,
  onClose,
}: {
  kind: DocumentEditorKind;
  keymap: EditorKeymapEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onRun: (commandId: EditorCommandId) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const normalizedQuery = query.trim().toLowerCase();
  const commands = editorCommandsForKind(kind, keymap).filter((command) => {
    if (!normalizedQuery) return true;
    const label = t(command.labelKey, {
      defaultValue: command.fallbackLabel,
    }).toLowerCase();
    return (
      label.includes(normalizedQuery) ||
      command.id.toLowerCase().includes(normalizedQuery) ||
      command.shortcuts.some((shortcut) =>
        shortcut.display.toLowerCase().includes(normalizedQuery),
      )
    );
  });

  function handlePaletteKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && commands[0]) {
      event.preventDefault();
      onRun(commands[0].id);
    }
  }

  return (
    <div
      className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3"
      onKeyDown={handlePaletteKeyDown}
    >
      <div className="mb-2 flex items-center gap-2">
        <Command className="h-3.5 w-3.5 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("documentEditor.commandPalettePlaceholder", {
            defaultValue: "Search commands",
          })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("common.close")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {commands.map((command) => (
          <CommandPaletteItem
            key={`${command.id}:${command.shortcuts[0]?.display ?? ""}`}
            command={command}
            onRun={onRun}
          />
        ))}
        {commands.length === 0 && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {t("documentEditor.noCommands", { defaultValue: "No commands" })}
          </div>
        )}
      </div>
    </div>
  );
}

function documentEditorKindLabel(kind: DocumentEditorKind) {
  if (kind === "docx") return "DOCX";
  if (kind === "xlsx") return "XLSX";
  if (kind === "pptx") return "PPTX";
  if (kind === "markdown") return "Markdown";
  if (kind === "csv") return "CSV";
  if (kind === "tsv") return "TSV";
  if (kind === "preview") return "Preview";
  return "Text";
}

function documentEditorStatusItems(kind: DocumentEditorKind, model: unknown) {
  if (!isPlainRecord(model)) return [];
  if (typeof model.content === "string") {
    return compactStatusItems([
      `${lineCount(model.content)} lines`,
      `${model.content.length} chars`,
      typeof model.encoding === "string" ? model.encoding : null,
      typeof model.lineEnding === "string" ? lineEndingLabel(model.lineEnding) : null,
      model.bom === true ? "BOM" : null,
      model.trailingNewline === false ? "no final newline" : null,
    ]);
  }
  if (Array.isArray(model.rows)) {
    const rows = model.rows.filter(Array.isArray);
    return compactStatusItems([
      `${rows.length} rows`,
      `${maxRowLength(rows)} columns`,
      typeof model.encoding === "string" ? model.encoding : null,
      typeof model.lineEnding === "string" ? lineEndingLabel(model.lineEnding) : null,
      model.bom === true ? "BOM" : null,
      model.trailingNewline === false ? "no final newline" : null,
    ]);
  }
  if (Array.isArray(model.blocks)) {
    const blocks = model.blocks.filter(isPlainRecord);
    return compactStatusItems([
      `${blocks.length} blocks`,
      `${blocks.filter((block) => block.type === "table").length} tables`,
      `${blocks.filter((block) => block.type === "image").length} images`,
      `${arrayLength(model.headers) + arrayLength(model.footers)} headers/footers`,
      `${arrayLength(model.comments)} comments`,
      `${arrayLength(model.footnotes) + arrayLength(model.endnotes)} notes`,
    ]);
  }
  if (Array.isArray(model.sheets)) {
    const sheets = model.sheets.filter(isPlainRecord);
    return compactStatusItems([
      `${sheets.length} sheets`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.rows), 0)} rows`,
      `${sheets.reduce((count, sheet) => count + sheetCellCount(sheet), 0)} cells`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.charts), 0)} charts`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.pivots), 0)} pivots`,
    ]);
  }
  if (Array.isArray(model.slides)) {
    const slides = model.slides.filter(isPlainRecord);
    return compactStatusItems([
      `${slides.length} slides`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.texts), 0)} text boxes`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.shapes), 0)} shapes`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.images), 0)} images`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.charts), 0)} charts`,
    ]);
  }
  return compactStatusItems([documentEditorKindLabel(kind)]);
}

function compactStatusItems(items: Array<string | null>) {
  return items.filter((item): item is string => Boolean(item));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function sheetCellCount(sheet: Record<string, unknown>) {
  if (!Array.isArray(sheet.rows)) return 0;
  return sheet.rows.reduce((count, row) => {
    if (!isPlainRecord(row) || !Array.isArray(row.cells)) return count;
    return count + row.cells.length;
  }, 0);
}

function maxRowLength(rows: unknown[][]) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function lineCount(content: string) {
  return content.length === 0 ? 1 : content.split("\n").length;
}

function lineEndingLabel(value: string) {
  if (value === "\r\n") return "CRLF";
  if (value === "\r") return "CR";
  if (value === "\n") return "LF";
  return value;
}

function CommandPaletteItem({
  command,
  onRun,
}: {
  command: EditorCommandDefinition;
  onRun: (commandId: EditorCommandId) => void;
}) {
  const { t } = useTranslation();
  const shortcut = command.shortcuts[0]?.display;
  return (
    <button
      type="button"
      onClick={() => onRun(command.id)}
      className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    >
      <span>{t(command.labelKey, { defaultValue: command.fallbackLabel })}</span>
      {shortcut && (
        <kbd className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

export function CompatibilityWarnings({
  warnings,
}: {
  warnings: DocumentCompatibilityWarning[];
}) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-warning)]" strokeWidth={1.75} />
        {t("documentEditor.compatibilityWarnings", {
          defaultValue: "Compatibility warnings",
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {warnings.map((warning) => (
          <span
            key={warning.code}
            className={cn(
              "inline-flex max-w-full items-center rounded-md border px-2 py-1 text-[11px]",
              warning.severity === "danger"
                ? "border-[var(--status-error)]/40 bg-[var(--status-error)]/10 text-[var(--status-error)]"
                : warning.severity === "warning"
                  ? "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 text-[var(--status-warning)]"
                  : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]",
            )}
            title={warning.code}
          >
            <span className="truncate">{warning.message}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function FindReplacePanel({
  query,
  replacement,
  matchCase,
  wholeWord,
  regexSearch,
  matchCount,
  onQueryChange,
  onReplacementChange,
  onMatchCaseChange,
  onWholeWordChange,
  onRegexSearchChange,
  onReplaceFirst,
  onReplaceAll,
  onClose,
}: {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
  matchCount: number;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onMatchCaseChange: (matchCase: boolean) => void;
  onWholeWordChange: (wholeWord: boolean) => void;
  onRegexSearchChange: (regexSearch: boolean) => void;
  onReplaceFirst: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <div className="flex min-w-56 flex-1 items-center gap-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("documentEditor.find", { defaultValue: "Find" })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <span className="min-w-16 text-right text-[11px] text-[var(--text-muted)]">
          {query ? matchCount : 0}
        </span>
      </div>
      <div className="flex min-w-56 flex-1 items-center gap-2">
        <Replace className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={replacement}
          onChange={(event) => onReplacementChange(event.target.value)}
          placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </div>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(event) => onMatchCaseChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.matchCase", { defaultValue: "Match case" })}
      </label>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={wholeWord}
          onChange={(event) => onWholeWordChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.wholeWord", { defaultValue: "Whole word" })}
      </label>
      <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={regexSearch}
          onChange={(event) => onRegexSearchChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("documentEditor.regex", { defaultValue: "Regex" })}
      </label>
      <button
        type="button"
        onClick={onReplaceFirst}
        disabled={!query || matchCount === 0}
        className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("documentEditor.replace", { defaultValue: "Replace" })}
      </button>
      <button
        type="button"
        onClick={onReplaceAll}
        disabled={!query || matchCount === 0}
        className="inline-flex h-8 items-center rounded-md bg-[var(--accent)] px-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("documentEditor.replaceAll", { defaultValue: "Replace all" })}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title={t("common.close")}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
