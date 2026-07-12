import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useDocumentEditorModel } from "@/features/documentEditor/shared/api";
import { missingDocumentEditorCapabilities } from "@/features/documentEditor/shared/capabilities";
import { CommandPalette } from "./documentEditorCommandPalette";
import { CompatibilityWarnings } from "./documentEditorCompatibilityWarnings";
import { FindReplacePanel } from "./documentEditorFindReplacePanel";
import {
  DocumentEditorSideHeader,
  DocumentEditorToolbar,
} from "./documentEditorShellHeader";
import { DocumentEditorStatusBar } from "./documentEditorStatusBar";
import { DocumentEditorBody } from "./DocumentEditorBody";
import {
  EditorFontFaces,
  ShortcutHelp,
} from "@/features/documentEditor/shared/shared";
import { useDocumentEditorSession } from "./useDocumentEditorSession";
import type { DocumentThreeWayComparison } from "./documentEditorThreeWayMerge";
import type {
  DocumentEditorModelResponse,
  DocumentRevisionProvenance,
} from "@/types/documentEditor";

interface DocumentEditorPaneProps {
  path: string | null;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenDocument?: (path: string) => void;
  variant?: "side" | "embedded";
  sourceChatSessionId?: string;
}

export function DocumentEditorPane({
  path,
  onClose,
  onDirtyChange,
  onOpenDocument,
  variant = "side",
  sourceChatSessionId,
}: DocumentEditorPaneProps) {
  const { t } = useTranslation();
  const query = useDocumentEditorModel(path);
  const data = query.data ?? null;
  const missingCapabilities = data
    ? missingDocumentEditorCapabilities(data.editorKind, data.capabilities)
    : [];

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
      {data && missingCapabilities.length > 0 && (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[var(--status-error)]">
          Document editor API mismatch. Missing capabilities:{" "}
          {missingCapabilities.join(", ")}. Refresh after the frontend and API
          deployments match.
        </div>
      )}
      {data && missingCapabilities.length === 0 && (
        <DocumentEditorContent
          key={data.path}
          data={data}
          onDirtyChange={onDirtyChange}
          refreshModel={async () => (await query.refetch()).data ?? null}
          onOpenDocument={onOpenDocument}
          sourceChatSessionId={sourceChatSessionId}
        />
      )}
    </aside>
  );
}

function DocumentEditorContent({
  data,
  onDirtyChange,
  refreshModel,
  onOpenDocument,
  sourceChatSessionId,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
  refreshModel: () => Promise<DocumentEditorModelResponse | null>;
  onOpenDocument?: (path: string) => void;
  sourceChatSessionId?: string;
}) {
  const { t } = useTranslation();
  const session = useDocumentEditorSession({
    data,
    onDirtyChange,
    refreshModel,
    sourceChatSessionId,
  });
  const {
    rootRef,
    draft,
    fingerprint,
    compatibilityWarnings,
    compatibilityValidationPending,
    compatibilityValidationError,
    validatedDraftSerializedSize,
    syncStatus,
    dirty,
    operationCount,
    selectionSnapshot,
    lastSavedAt,
    isSaving,
    isSaveQueued,
    lifecycleStatus,
    saveError,
    saveErrorMessage,
    saveConflict,
    saveCopyOpen,
    saveCopyTargetPath,
    savedCopyPath,
    isSavingCopy,
    saveCopyError,
    externalRevisionAvailable,
    externalRevisionSource,
    externalRevisionProvenance,
    externalComparison,
    recoveryDraftAvailable,
    recoveryError,
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
    searchError,
    editorCommandRequest,
    commitDraft,
    undo,
    redo,
    save,
    overwriteConflict,
    openSaveConflictCopy,
    saveConflictCopy,
    reloadExternalRevision,
    rebaseExternalRevision,
    restoreRecoveryDraft,
    dismissRecoveryDraft,
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
    setSaveCopyOpen,
    setSaveCopyTargetPath,
    replaceFirst,
    replaceAll,
  } = session;

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
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
          {saveErrorMessage ? `: ${saveErrorMessage}` : ""}
        </div>
      )}
      {syncStatus === "failed" && (
        <div className="border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-2 text-xs text-[var(--status-warning)]">
          The document is available from the committed local revision, but remote
          Drive sync is not queued or failed. Local save is not rolled back; check
          Drive sync status and retry separately.
        </div>
      )}
      {saveConflict && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-2 text-xs text-[var(--status-warning)]">
          <div className="min-w-0">
            <span>{t("documentEditor.conflictMessage")}</span>
            <RevisionProvenanceLabel
              source={externalRevisionSource}
              provenance={externalRevisionProvenance}
            />
            <ExternalRevisionComparison comparison={externalComparison} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openSaveConflictCopy}
              disabled={isSaving || isSavingCopy}
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save a copy
            </button>
            <button
              type="button"
              onClick={rebaseExternalRevision}
              disabled={
                isSaving ||
                !externalComparison ||
                externalComparison.conflictPaths.length > 0
              }
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Rebase independent changes
            </button>
            <button
              type="button"
              onClick={() => void overwriteConflict()}
              disabled={isSaving}
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("documentEditor.overwriteConflict", {
                defaultValue: "Overwrite",
              })}
            </button>
            <button
              type="button"
              onClick={() => void reloadExternalRevision()}
              disabled={isSaving}
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10"
            >
              {t("documentEditor.reload")}
            </button>
          </div>
        </div>
      )}
      {savedCopyPath && (
        <div className="border-b border-[var(--status-success)]/40 bg-[var(--status-success)]/10 px-4 py-2 text-xs text-[var(--status-success)]">
          Draft copy saved as {savedCopyPath}. The original conflict remains open until
          you rebase, overwrite the reviewed revision, or reload.
        </div>
      )}
      {saveCopyOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-save-copy-title"
            className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 shadow-xl"
          >
            <h2 id="document-save-copy-title" className="text-sm font-semibold text-[var(--text)]">
              Save the local draft as a copy
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
              The copy is serialized from the exact package revision this draft was
              based on. The externally changed original file is not overwritten.
            </p>
            <label className="mt-3 block text-xs text-[var(--text-muted)]">
              Drive path
              <input
                value={saveCopyTargetPath}
                onChange={(event) => setSaveCopyTargetPath(event.target.value)}
                disabled={isSavingCopy}
                className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            {saveCopyError && (
              <div className="mt-2 rounded-md bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
                {saveCopyError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSaveCopyOpen(false)}
                disabled={isSavingCopy}
                className="h-8 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--text-muted)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveConflictCopy()}
                disabled={isSavingCopy || !saveCopyTargetPath.trim()}
                className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs text-white disabled:opacity-50"
              >
                {isSavingCopy ? "Saving copy…" : "Save copy"}
              </button>
            </div>
          </div>
        </div>
      )}
      {externalRevisionAvailable && !saveConflict && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-2 text-xs text-[var(--status-warning)]">
          <div className="min-w-0">
            <span>
              {t("documentEditor.externalRevisionMessage", {
                defaultValue:
                  externalRevisionSource === "another-tab"
                    ? "Another browser tab saved this file. Your draft is preserved; compare or rebase before replacing it."
                    : externalRevisionProvenance?.actorKind === "agent"
                      ? `Agent ${externalRevisionProvenance.actorId ?? "unknown"} saved this file. Your unpublished browser draft was not visible to the agent and remains preserved.`
                    : "This file changed outside the editor. Your draft is preserved; reload only if you want to discard it.",
              })}
            </span>
            <RevisionProvenanceLabel
              source={externalRevisionSource}
              provenance={externalRevisionProvenance}
            />
            <ExternalRevisionComparison comparison={externalComparison} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={rebaseExternalRevision}
              disabled={
                isSaving ||
                !externalComparison ||
                externalComparison.conflictPaths.length > 0
              }
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Rebase independent changes
            </button>
            <button
              type="button"
              onClick={() => void reloadExternalRevision()}
              disabled={isSaving}
              className="rounded-md border border-[var(--status-warning)]/40 px-2 py-1 hover:bg-[var(--status-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("documentEditor.reload")}
            </button>
          </div>
        </div>
      )}
      {recoveryDraftAvailable && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2 text-xs text-[var(--text)]">
          <span>
            {t("documentEditor.recoveryDraftMessage", {
              defaultValue:
                "An unsaved browser recovery draft is available. Restore it or dismiss it before continuing.",
            })}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={restoreRecoveryDraft}
              disabled={isSaving}
              className="rounded-md border border-[var(--accent)]/40 px-2 py-1 hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("documentEditor.restoreDraft", { defaultValue: "Restore draft" })}
            </button>
            <button
              type="button"
              onClick={dismissRecoveryDraft}
              disabled={isSaving}
              className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.dismiss", { defaultValue: "Dismiss" })}
            </button>
          </div>
        </div>
      )}
      {recoveryError && dirty && (
        <div className="border-b border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.recoveryStorageError", {
            defaultValue:
              "Browser recovery storage is unavailable. Keep this tab open or save before navigating away.",
          })}
          {`: ${recoveryError}`}
        </div>
      )}
      {compatibilityValidationPending && (
        <div className="border-b border-[var(--status-warning)]/30 bg-[var(--status-warning)]/5 px-4 py-1.5 text-[11px] text-[var(--status-warning)]">
          {t("documentEditor.compatibilityPending", {
            defaultValue:
              "Validating the current draft and recomputing compatibility warnings…",
          })}
        </div>
      )}
      {dirty && compatibilityValidationError && (
        <div className="border-b border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-4 py-1.5 text-[11px] text-[var(--status-error)]">
          Current draft validation failed: {compatibilityValidationError}. Saving
          remains blocked by the same server validation.
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
      <CompatibilityWarnings warnings={compatibilityWarnings} />
      {shortcutHelpOpen && <ShortcutHelp kind={data.editorKind} keymap={keymapEntries} />}
      {findPanelOpen && (
        <FindReplacePanel
          query={findQuery}
          replacement={replaceValue}
          matchCase={matchCase}
          wholeWord={wholeWord}
          regexSearch={regexSearch}
          matchCount={matchCount}
          searchError={searchError}
          scopeLabel={documentSearchScopeLabel(data.editorKind)}
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
        operationCount={operationCount}
        selectionLabel={selectionSnapshot.label}
        isSaving={isSaving}
        isSaveQueued={isSaveQueued}
        warningCount={compatibilityWarnings.length}
        syncStatus={syncStatus}
        validatedDraftSerializedSize={validatedDraftSerializedSize}
        lifecycleStatus={lifecycleStatus}
      />
    </div>
  );
}

function documentSearchScopeLabel(kind: DocumentEditorModelResponse["editorKind"]) {
  if (kind === "xlsx") return "Cell values only · formulas excluded";
  if (kind === "docx") return "Editable body paragraphs only";
  if (kind === "pptx") return "Editable plain text boxes only";
  if (kind === "csv" || kind === "tsv") return "All table cells";
  return "Document source";
}

function ExternalRevisionComparison({
  comparison,
}: {
  comparison: DocumentThreeWayComparison | null;
}) {
  if (!comparison) {
    return (
      <div className="mt-1 text-[10px] opacity-80">
        Refresh the durable revision to compare changes.
      </div>
    );
  }
  return (
    <details className="mt-1 text-[10px] text-[var(--text-muted)]">
      <summary className="cursor-pointer">
        Compare: {comparison.localChangedPaths.length} local ·{" "}
        {comparison.externalChangedPaths.length} external ·{" "}
        {comparison.conflictPaths.length} overlapping
      </summary>
      <div className="mt-1 grid gap-1 rounded border border-[var(--border)] bg-[var(--bg)] p-2 font-mono">
        <span>
          Local: {comparison.localChangedPaths.join(", ") || "none"}
        </span>
        <span>
          External: {comparison.externalChangedPaths.join(", ") || "none"}
        </span>
        <span
          className={
            comparison.conflictPaths.length > 0
              ? "text-[var(--status-danger)]"
              : "text-[var(--status-success)]"
          }
        >
          Conflicts: {comparison.conflictPaths.join(", ") || "none"}
        </span>
      </div>
    </details>
  );
}

function RevisionProvenanceLabel({
  source,
  provenance,
}: {
  source: "another-tab" | "external" | null;
  provenance: DocumentRevisionProvenance | null;
}) {
  const label =
    source === "another-tab"
      ? "Source: another browser tab"
      : provenance?.actorKind === "agent"
        ? `Source: agent ${provenance.actorId ?? "unknown"} via ${provenance.source}`
        : provenance?.actorKind === "user"
          ? `Source: user write via ${provenance.source}`
          : provenance?.actorKind === "system"
            ? `Source: system via ${provenance.source}`
            : "Source: external or unknown writer";
  return <div className="mt-1 text-[10px] opacity-80">{label}</div>;
}
