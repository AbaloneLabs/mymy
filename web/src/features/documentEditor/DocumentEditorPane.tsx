import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useDocumentEditorModel } from "@/features/documentEditor/api";
import type { EditorCommandRequest } from "@/features/documentEditor/commands";
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
} from "@/features/documentEditor/models";
import {
  EditorFontFaces,
  ShortcutHelp,
} from "@/features/documentEditor/shared";
import { useDocumentEditorSession } from "@/features/documentEditor/useDocumentEditorSession";
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
  const session = useDocumentEditorSession({ data, onDirtyChange });
  const {
    rootRef,
    draft,
    dirty,
    lastSavedAt,
    isSaving,
    saveError,
    canUndo,
    canRedo,
    keymapEntries,
    shortcutHelpOpen,
    commandPaletteOpen,
    commandPaletteQuery,
    findPanelOpen,
    findQuery,
    replaceValue,
    matchCase,
    matchCount,
    editorCommandRequest,
    commitDraft,
    undo,
    redo,
    save,
    downloadPackage,
    openCommandPalette,
    runShellCommand,
    clearEditorCommandRequest,
    setShortcutHelpOpen,
    setCommandPaletteOpen,
    setCommandPaletteQuery,
    setFindPanelOpen,
    setFindQuery,
    setReplaceValue,
    setMatchCase,
    replaceFirst,
    replaceAll,
  } = session;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DocumentEditorToolbar
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        isSaving={isSaving}
        canUndo={canUndo}
        canRedo={canRedo}
        findPanelOpen={findPanelOpen}
        onToggleShortcutHelp={() => setShortcutHelpOpen((current) => !current)}
        onOpenCommandPalette={openCommandPalette}
        onUndo={undo}
        onRedo={redo}
        onDownloadPackage={() => void downloadPackage()}
        onToggleFindPanel={() => setFindPanelOpen((current) => !current)}
        onSave={() => void save()}
      />

      {saveError && (
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
