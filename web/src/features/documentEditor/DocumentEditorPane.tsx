import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  useDocumentEditorModel,
  useWriteDocumentEditorModel,
} from "@/features/documentEditor/api";
import {
  editorCommandsForKind,
  matchesEditorShortcut,
  type EditorCommandId,
  type EditorCommandRequest,
} from "@/features/documentEditor/commands";
import {
  CommandPalette,
  CompatibilityWarnings,
  DocumentEditorSideHeader,
  DocumentEditorToolbar,
  FindReplacePanel,
} from "@/features/documentEditor/DocumentEditorShell";
import { MarkdownRichEditor } from "@/features/documentEditor/editors/MarkdownEditor";
import { PlainTextEditor } from "@/features/documentEditor/editors/TextEditor";
import { DocxEditor } from "@/features/documentEditor/editors/WordEditor";
import { DelimitedTableEditor } from "@/features/documentEditor/editors/DelimitedTableEditor";
import { XlsxEditor } from "@/features/documentEditor/editors/SpreadsheetEditor";
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
  DocumentEditorKind,
  DocumentEditorModelResponse,
} from "@/types/documentEditor";

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
        <DocumentEditorSideHeader
          name={data?.name ?? null}
          path={path}
          onClose={onClose}
        />
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
      <DocumentEditorToolbar
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        isSaving={writeModel.isPending}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        findPanelOpen={findPanelOpen}
        onToggleShortcutHelp={() => setShortcutHelpOpen((current) => !current)}
        onOpenCommandPalette={() => {
          setCommandPaletteQuery("");
          setCommandPaletteOpen(true);
        }}
        onUndo={undo}
        onRedo={redo}
        onDownloadPackage={() => void downloadPackage()}
        onToggleFindPanel={() => setFindPanelOpen((current) => !current)}
        onSave={() => void save()}
      />

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
