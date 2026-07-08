import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useDocumentEditorModel } from "@/features/documentEditor/api";
import {
  CommandPalette,
  CompatibilityWarnings,
  DocumentEditorSideHeader,
  DocumentEditorStatusBar,
  DocumentEditorToolbar,
  FindReplacePanel,
} from "@/features/documentEditor/DocumentEditorShell";
import { DocumentEditorBody } from "@/features/documentEditor/DocumentEditorBody";
import {
  EditorFontFaces,
  ShortcutHelp,
} from "@/features/documentEditor/shared";
import { useDocumentEditorSession } from "@/features/documentEditor/useDocumentEditorSession";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";

interface DocumentEditorPaneProps {
  path: string | null;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenDocument?: (path: string) => void;
  variant?: "side" | "embedded";
}

export function DocumentEditorPane({
  path,
  onClose,
  onDirtyChange,
  onOpenDocument,
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
          onReload={() => void query.refetch()}
          onOpenDocument={onOpenDocument}
        />
      )}
    </aside>
  );
}

function DocumentEditorContent({
  data,
  onDirtyChange,
  onReload,
  onOpenDocument,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
  onReload: () => void;
  onOpenDocument?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const session = useDocumentEditorSession({ data, onDirtyChange });
  const {
    rootRef,
    draft,
    fingerprint,
    dirty,
    lastSavedAt,
    isSaving,
    isSaveQueued,
    saveError,
    saveConflict,
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
    wholeWord,
    regexSearch,
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
    setWholeWord,
    setRegexSearch,
    replaceFirst,
    replaceAll,
  } = session;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <DocumentEditorToolbar
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        isSaving={isSaving}
        isSaveQueued={isSaveQueued}
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
      {saveConflict && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-2 text-xs text-[var(--status-warning)]">
          <span>{t("documentEditor.conflictMessage")}</span>
          <button
            type="button"
            onClick={onReload}
            className="shrink-0 rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10"
          >
            {t("documentEditor.reload")}
          </button>
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
          wholeWord={wholeWord}
          regexSearch={regexSearch}
          matchCount={matchCount}
          onQueryChange={setFindQuery}
          onReplacementChange={setReplaceValue}
          onMatchCaseChange={setMatchCase}
          onWholeWordChange={setWholeWord}
          onRegexSearchChange={setRegexSearch}
          onReplaceFirst={replaceFirst}
          onReplaceAll={replaceAll}
          onClose={() => setFindPanelOpen(false)}
        />
      )}
      <EditorFontFaces />
      <div className="min-h-0 flex-1 overflow-hidden">
        <DocumentEditorBody
          path={data.path}
          kind={data.editorKind}
          model={draft}
          onChange={commitDraft}
          commandRequest={editorCommandRequest}
          onCommandHandled={clearEditorCommandRequest}
          onOpenDocument={onOpenDocument}
        />
      </div>
      <DocumentEditorStatusBar
        kind={data.editorKind}
        model={draft}
        fingerprint={fingerprint}
        dirty={dirty}
        isSaving={isSaving}
        isSaveQueued={isSaveQueued}
        warningCount={data.compatibilityWarnings?.length ?? 0}
      />
    </div>
  );
}
