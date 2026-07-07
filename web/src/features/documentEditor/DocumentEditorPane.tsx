import { useEffect, useRef, useState } from "react";
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
  useDocumentEditorModel,
  useWriteDocumentEditorModel,
} from "@/features/documentEditor/api";
import {
  editorCommandsForKind,
  matchesEditorShortcut,
  type EditorCommandDefinition,
  type EditorCommandId,
  type EditorCommandRequest,
} from "@/features/documentEditor/commands";
import { MarkdownRichEditor } from "@/features/documentEditor/editors/MarkdownEditor";
import { PlainTextEditor } from "@/features/documentEditor/editors/TextEditor";
import { DocxEditor } from "@/features/documentEditor/editors/WordEditor";
import {
  DelimitedTableEditor,
  XlsxEditor,
} from "@/features/documentEditor/editors/SpreadsheetEditor";
import { PptxEditor } from "@/features/documentEditor/editors/PresentationEditor";
import {
  normalizeDelimitedTableModel,
  normalizeDocxModel,
  normalizePptxModel,
  normalizeTextModel,
  normalizeXlsxModel,
  stableJson,
} from "@/features/documentEditor/models";
import {
  EditorFontFaces,
  ShortcutHelp,
} from "@/features/documentEditor/shared";
import { useEditorKeymap } from "@/features/documentEditor/fonts";
import {
  countModelMatches,
  replaceAllInModel,
  replaceFirstInModel,
} from "@/features/documentEditor/search";
import { drivePackageUrl } from "@/features/drive/api";
import type {
  DocumentCompatibilityWarning,
  DocumentEditorKind,
  DocumentEditorModelResponse,
} from "@/types/documentEditor";
import type { EditorKeymapEntry } from "@/types/editorSettings";

interface DocumentEditorPaneProps {
  path: string | null;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  variant?: "side" | "embedded";
}

export function DocumentEditorPane({
  path,
  onClose,
  onDirtyChange,
  variant = "side",
}: DocumentEditorPaneProps) {
  const { t } = useTranslation();
  const query = useDocumentEditorModel(path);
  const data = query.data ?? null;

  if (!path) return null;

  return (
    <aside
      className={cn(
        "flex h-full min-w-0 flex-col bg-[var(--bg)]",
        variant === "side" && "border-l border-[var(--border)]",
      )}
    >
      {variant === "side" && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--text)]">
              {data?.name ?? t("documentEditor.title")}
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
      )}

      {query.isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("common.loading")}
        </div>
      )}
      {query.isError && (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[var(--status-error)]">
          {t("documentEditor.loadError")}
        </div>
      )}
      {data && (
        <DocumentEditorContent
          key={`${data.path}:${data.fingerprint}`}
          data={data}
          onDirtyChange={onDirtyChange}
        />
      )}
    </aside>
  );
}

function DocumentEditorContent({
  data,
  onDirtyChange,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const writeModel = useWriteDocumentEditorModel();
  const keymap = useEditorKeymap();
  const keymapEntries = keymap.data?.shortcuts ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<unknown>(() => data.model);
  const [baseKey, setBaseKey] = useState(() => stableJson(data.model));
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [editorCommandRequest, setEditorCommandRequest] =
    useState<EditorCommandRequest | null>(null);
  const [history, setHistory] = useState<{ past: unknown[]; future: unknown[] }>({
    past: [],
    future: [],
  });
  const draftKey = stableJson(draft);
  const dirty = draftKey !== baseKey;
  const matchCount = countModelMatches(draft, {
    query: findQuery,
    matchCase,
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function commitDraft(next: unknown) {
    if (stableJson(next) === stableJson(draft)) return;
    setHistory((current) => ({
      past: [...current.past, draft].slice(-100),
      future: [],
    }));
    setDraft(next);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (previous === undefined) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [draft, ...history.future].slice(0, 100),
    });
    setDraft(previous);
  }

  function redo() {
    const next = history.future[0];
    if (next === undefined) return;
    setHistory({
      past: [...history.past, draft].slice(-100),
      future: history.future.slice(1),
    });
    setDraft(next);
  }

  function replaceFirst() {
    const result = replaceFirstInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  function replaceAll() {
    const result = replaceAllInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  async function save() {
    if (!data || writeModel.isPending) return false;
    if (!dirty) return true;
    const saved = await writeModel.mutateAsync({
      path: data.path,
      editorKind: data.editorKind,
      model: draft,
      expectedFingerprint: data.fingerprint,
    });
    setDraft(saved.model);
    setBaseKey(stableJson(saved.model));
    setLastSavedAt(new Date().toLocaleTimeString());
    return true;
  }

  async function downloadPackage() {
    if (writeModel.isPending) return;
    const saved = await save();
    if (!saved) return;
    window.location.assign(drivePackageUrl(data.path));
  }

  function runShellCommand(commandId: EditorCommandId) {
    setCommandPaletteOpen(false);
    const command = editorCommandsForKind(data.editorKind, keymapEntries).find(
      (item) => item.id === commandId,
    );
    if (command && !command.handledByShell) {
      setEditorCommandRequest({ id: commandId, token: Date.now() + Math.random() });
      return;
    }
    if (commandId === "save") {
      void save();
      return;
    }
    if (commandId === "downloadPackage") {
      void downloadPackage();
      return;
    }
    if (commandId === "undo") {
      undo();
      return;
    }
    if (commandId === "redo") {
      redo();
      return;
    }
    if (commandId === "find" || commandId === "replace") {
      setFindPanelOpen(true);
      return;
    }
    if (commandId === "shortcuts") {
      setShortcutHelpOpen((current) => !current);
      return;
    }
    if (commandId === "commandPalette") {
      setCommandPaletteQuery("");
      setCommandPaletteOpen(true);
    }
  }

  function clearEditorCommandRequest(request: EditorCommandRequest) {
    setEditorCommandRequest((current) =>
      current?.token === request.token ? null : current,
    );
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) return;
      const command = editorCommandsForKind(data.editorKind, keymapEntries).find((item) =>
        matchesEditorShortcut(event, item),
      );
      if (!command) return;
      event.preventDefault();
      runShellCommand(command.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-4 py-2">
        <button
          type="button"
          onClick={() => setShortcutHelpOpen((current) => !current)}
          className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title={t("documentEditor.shortcuts", { defaultValue: "Shortcuts" })}
        >
          <Keyboard className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.shortcuts", { defaultValue: "Shortcuts" })}
        </button>
        <button
          type="button"
          onClick={() => {
            setCommandPaletteQuery("");
            setCommandPaletteOpen(true);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          title={t("documentEditor.commandPalette", {
            defaultValue: "Command palette",
          })}
        >
          <Command className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={history.past.length === 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title={t("documentEditor.undo", { defaultValue: "Undo" })}
        >
          <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={history.future.length === 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title={t("documentEditor.redo", { defaultValue: "Redo" })}
        >
          <Redo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => void downloadPackage()}
          disabled={writeModel.isPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title={t("drive.downloadPackage")}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setFindPanelOpen((current) => !current)}
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
            {t("documentEditor.unsaved")}
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
          onClick={() => void save()}
          disabled={!dirty || writeModel.isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {writeModel.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {t("common.save")}
        </button>
      </div>

      {writeModel.isError && (
        <div className="border-b border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.saveError")}
        </div>
      )}
      {commandPaletteOpen && (
        <CommandPalette
          kind={data.editorKind}
          keymap={keymapEntries}
          query={commandPaletteQuery}
          onQueryChange={setCommandPaletteQuery}
          onRun={runShellCommand}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      <CompatibilityWarnings warnings={data.compatibilityWarnings ?? []} />
      {shortcutHelpOpen && <ShortcutHelp kind={data.editorKind} keymap={keymapEntries} />}
      {findPanelOpen && (
        <FindReplacePanel
          query={findQuery}
          replacement={replaceValue}
          matchCase={matchCase}
          matchCount={matchCount}
          onQueryChange={setFindQuery}
          onReplacementChange={setReplaceValue}
          onMatchCaseChange={setMatchCase}
          onReplaceFirst={replaceFirst}
          onReplaceAll={replaceAll}
          onClose={() => setFindPanelOpen(false)}
        />
      )}
      <EditorFontFaces />
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorBody
          path={data.path}
          kind={data.editorKind}
          model={draft}
          onChange={commitDraft}
          commandRequest={editorCommandRequest}
          onCommandHandled={clearEditorCommandRequest}
        />
      </div>
    </div>
  );
}

function CommandPalette({
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
      <span>
        {t(command.labelKey, { defaultValue: command.fallbackLabel })}
      </span>
      {shortcut && (
        <kbd className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function CompatibilityWarnings({
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

function FindReplacePanel({
  query,
  replacement,
  matchCase,
  matchCount,
  onQueryChange,
  onReplacementChange,
  onMatchCaseChange,
  onReplaceFirst,
  onReplaceAll,
  onClose,
}: {
  query: string;
  replacement: string;
  matchCase: boolean;
  matchCount: number;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onMatchCaseChange: (matchCase: boolean) => void;
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

function EditorBody({
  path,
  kind,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  path: string;
  kind: DocumentEditorKind;
  model: unknown;
  onChange: (model: unknown) => void;
  commandRequest: EditorCommandRequest | null;
  onCommandHandled: (request: EditorCommandRequest) => void;
}) {
  if (kind === "markdown") {
    return (
      <MarkdownRichEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "text") {
    return (
      <PlainTextEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "csv" || kind === "tsv") {
    return (
      <DelimitedTableEditor
        model={normalizeDelimitedTableModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "docx") {
    return (
      <DocxEditor
        model={normalizeDocxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "xlsx") {
    return (
      <XlsxEditor
        model={normalizeXlsxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "pptx") {
    return (
      <PptxEditor
        model={normalizePptxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  return null;
}
