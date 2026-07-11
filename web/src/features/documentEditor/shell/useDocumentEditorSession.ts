import {
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  editorCommandsForKind,
  matchesEditorShortcut,
  type EditorCommandId,
  type EditorCommandRequest,
} from "@/features/documentEditor/shared/commands";
import {
  useEditorKeymap,
  useEditorPreferences,
} from "@/features/documentEditor/shared/fonts";
import {
  captureEditorSelection,
  type EditorSelectionSnapshot,
} from "@/features/documentEditor/shared/selectionStore";
import {
  useSaveDocumentEditorCopy,
  useWriteDocumentEditorModel,
  isDocumentEditorConflictError,
} from "@/features/documentEditor/shared/api";
import { requiredDocumentEditorCapabilities } from "@/features/documentEditor/shared/capabilities";
import { drivePackageUrl } from "@/features/drive/api";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";
import { reviewedConflictFingerprint } from "./documentEditorRevisionState";
import {
  createDocumentEditorSessionState,
  documentEditorSessionReducer,
  type ExternalRevisionSource,
} from "./documentEditorSessionState";
import { useDocumentEditorHistory } from "./useDocumentEditorHistory";
import { useDocumentEditorAutosave } from "./useDocumentEditorAutosave";
import { useDocumentEditorSearch } from "./useDocumentEditorSearch";
import { useDocumentEditorCompatibilityValidation } from "./useDocumentEditorCompatibilityValidation";
import { useDocumentEditorRecovery } from "./useDocumentEditorRecovery";
import { compareAndMergeDocumentModels } from "./documentEditorThreeWayMerge";
import {
  publishDocumentEditorRevision,
  subscribeToDocumentEditorRevisions,
  type DocumentEditorRevisionNotice,
} from "./documentEditorRevisionChannel";

export function useDocumentEditorSession({
  data,
  onDirtyChange,
  refreshModel,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
  refreshModel?: () => Promise<DocumentEditorModelResponse | null>;
}) {
  const writeModel = useWriteDocumentEditorModel();
  const saveCopyMutation = useSaveDocumentEditorCopy();
  const keymap = useEditorKeymap();
  const preferences = useEditorPreferences();
  const keymapEntries = keymap.data?.shortcuts ?? [];
  const autosaveEnabled = preferences.data?.preferences.autosaveEnabled === true;
  const autosaveDelayMs = preferences.data?.preferences.autosaveDelayMs ?? 5_000;
  const rootRef = useRef<HTMLDivElement>(null);
  const [sessionState, dispatchSession] = useReducer(
    documentEditorSessionReducer,
    data,
    createDocumentEditorSessionState,
  );
  const {
    currentModel: draft,
    currentKey: draftKey,
    serverModel: baseModel,
    serverKey: baseKey,
    acceptedFingerprint: fingerprint,
    compatibilityWarnings,
    syncStatus,
    externalRevision,
    externalRevisionSource,
    saveConflict,
  } = sessionState;
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveCopyOpen, setSaveCopyOpen] = useState(false);
  const [saveCopyTargetPath, setSaveCopyTargetPath] = useState(() =>
    defaultDocumentCopyPath(data.path),
  );
  const [savedCopyPath, setSavedCopyPath] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [editorCommandRequest, setEditorCommandRequest] =
    useState<EditorCommandRequest | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] =
    useState<EditorSelectionSnapshot>(() => ({ kind: "none", label: "No selection" }));
  const editorHistory = useDocumentEditorHistory();
  const latestDraftRef = useRef(draft);
  const latestDraftKeyRef = useRef(draftKey);
  const pendingSaveIdentityRef = useRef<{
    draftKey: string;
    expectedFingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const pendingCopyIdentityRef = useRef<{
    draftKey: string;
    targetPath: string;
    baseFingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const dirty = draftKey !== baseKey;
  const recovery = useDocumentEditorRecovery({
    data,
    baseModel,
    draft,
    draftKey,
    dirty,
    fingerprint,
  });
  const recoveryDraft = recovery.availableDraft;
  const recoverySessionId = recovery.sessionId;
  const externalComparison = useMemo(
    () =>
      externalRevision
        ? compareAndMergeDocumentModels(
            baseModel,
            draft,
            externalRevision.model,
          )
        : null,
    [baseModel, draft, externalRevision],
  );
  const compatibilityValidation = useDocumentEditorCompatibilityValidation({
    data: { ...data, compatibilityWarnings },
    draft,
    draftKey,
    dirty,
    fingerprint,
    saveConflict,
  });
  const autosave = useDocumentEditorAutosave({
    enabled: autosaveEnabled,
    delayMs: autosaveDelayMs,
    dirty,
    draftKey,
    savePending: writeModel.isPending,
    saveConflict,
    onSave: () => void save(),
  });
  useEffect(() => {
    latestDraftRef.current = draft;
    latestDraftKeyRef.current = draftKey;
  }, [
    baseModel,
    data.editorKind,
    data.modelSchemaVersion,
    data.path,
    dirty,
    draft,
    draftKey,
    fingerprint,
    recoverySessionId,
  ]);
  const updateSelectionSnapshot = useEffectEvent(() => {
    setSelectionSnapshot(captureEditorSelection(rootRef.current, data.editorKind));
  });
  const observeIncomingRevision = useEffectEvent(
    (
      incoming: DocumentEditorModelResponse,
      source: ExternalRevisionSource = "external",
    ) => {
      if (
        incoming.fingerprint !== fingerprint &&
        !dirty &&
        !writeModel.isPending
      ) {
        dispatchSession({ type: "incomingRevision", response: incoming, source });
        autosave.clear();
        editorHistory.reset();
        compatibilityValidation.reset();
        recovery.clearAvailable();
        recovery.deleteCurrentSessionDraft();
        writeModel.reset();
        return;
      }
      dispatchSession({ type: "incomingRevision", response: incoming, source });
    },
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    // Query updates are an external event. Schedule adoption after the current
    // render so a server refetch cannot synchronously cascade through the
    // editor's controlled model tree.
    const timer = window.setTimeout(() => observeIncomingRevision(data), 0);
    return () => window.clearTimeout(timer);
  }, [data]);

  const receiveRevisionNotice = useEffectEvent(
    (notice: DocumentEditorRevisionNotice) => {
      if (
        notice.path !== data.path ||
        notice.sourceSessionId === recoverySessionId ||
        notice.fingerprint === fingerprint ||
        !refreshModel
      ) {
        return;
      }
      void refreshModel()
        .then((incoming) => {
          if (!incoming || incoming.fingerprint !== notice.fingerprint) return;
          observeIncomingRevision(incoming, "another-tab");
        })
        .catch(() => undefined);
    },
  );

  useEffect(
    () => subscribeToDocumentEditorRevisions(receiveRevisionNotice),
    [],
  );

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleSelectionChange = () => updateSelectionSnapshot();
    const handleFocusIn = () => updateSelectionSnapshot();
    document.addEventListener("selectionchange", handleSelectionChange);
    root.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      root.removeEventListener("focusin", handleFocusIn);
    };
  }, []);

  function commitDraft(next: unknown) {
    const transition = editorHistory.commit(draft, draftKey, next);
    if (!transition) return;
    writeModel.reset();
    if (writeModel.isPending) autosave.queue();
    dispatchSession({
      type: "localDraft",
      model: transition.model,
      key: transition.key,
    });
  }

  function undo() {
    const transition = editorHistory.undo(draft);
    if (!transition) return;
    dispatchSession({
      type: "localDraft",
      model: transition.model,
      key: transition.key,
    });
  }

  function redo() {
    const transition = editorHistory.redo(draft);
    if (!transition) return;
    dispatchSession({
      type: "localDraft",
      model: transition.model,
      key: transition.key,
    });
  }

  async function save(options: { expectedFingerprint?: string } = {}) {
    if (writeModel.isPending) {
      if (dirty) autosave.queue();
      return false;
    }
    if (!dirty) return true;
    const savingDraftKey = draftKey;
    const savingDraft = latestDraftRef.current;
    const expectedFingerprint = options.expectedFingerprint ?? fingerprint;
    const pendingIdentity = pendingSaveIdentityRef.current;
    const saveIdentity =
      pendingIdentity?.draftKey === savingDraftKey &&
      pendingIdentity.expectedFingerprint === expectedFingerprint
        ? pendingIdentity
        : {
            draftKey: savingDraftKey,
            expectedFingerprint,
            idempotencyKey: crypto.randomUUID(),
          };
    pendingSaveIdentityRef.current = saveIdentity;
    dispatchSession({
      type: "saveStarted",
      snapshotKey: savingDraftKey,
      expectedFingerprint,
    });
    writeModel.reset();
    try {
      const saved = await writeModel.mutateAsync({
        path: data.path,
        editorKind: data.editorKind,
        model: savingDraft,
        modelSchemaVersion: data.modelSchemaVersion,
        requiredCapabilities: requiredDocumentEditorCapabilities(data.editorKind),
        idempotencyKey: saveIdentity.idempotencyKey,
        expectedFingerprint,
        syncQuery: true,
      });
      const savedKey = savingDraftKey;
      autosave.clear();
      dispatchSession({
        type: "saveSucceeded",
        snapshotKey: savedKey,
        response: saved,
      });
      compatibilityValidation.reset();
      setLastSavedAt(new Date().toLocaleTimeString());
      recovery.clearAvailable();
      if (pendingSaveIdentityRef.current === saveIdentity) {
        pendingSaveIdentityRef.current = null;
      }
      publishDocumentEditorRevision({
        path: data.path,
        fingerprint: saved.fingerprint,
        sourceSessionId: recoverySessionId,
      });
      if (latestDraftKeyRef.current === savingDraftKey) {
        recovery.deleteOwnedDrafts();
        return true;
      }
      recovery.deleteRestoredDraft();
      recovery.persistCurrentDraft({
        baseFingerprint: saved.fingerprint,
        nextBaseModel: saved.model,
        model: latestDraftRef.current,
      });
      autosave.queue();
      return false;
    } catch (error) {
      if (isDocumentEditorConflictError(error)) {
        dispatchSession({ type: "saveFailed", conflict: true });
        autosave.clear();
        const refreshed = await refreshModel?.().catch(() => null);
        if (refreshed && refreshed.fingerprint !== fingerprint) {
          dispatchSession({
            type: "incomingRevision",
            response: refreshed,
            source: "external",
          });
        }
        return false;
      }
      dispatchSession({ type: "saveFailed", conflict: false });
      // A second explicit save made while the first request was pending is a
      // real follow-up intent. Preserve that one retry after a transport
      // failure, while successful and conflict transitions clear both the UI
      // flag and the authoritative ref so it cannot leak into a later edit.
      return false;
    }
  }

  async function overwriteConflict() {
    if (!saveConflict) return false;
    const reviewedRevision =
      externalRevision ?? (await refreshModel?.().catch(() => null));
    const reviewedFingerprint = reviewedConflictFingerprint({
      acceptedFingerprint: fingerprint,
      reviewedFingerprint: reviewedRevision?.fingerprint,
    });
    if (!reviewedFingerprint) return false;
    return save({ expectedFingerprint: reviewedFingerprint });
  }

  function openSaveConflictCopy() {
    setSaveCopyTargetPath(defaultDocumentCopyPath(data.path));
    setSavedCopyPath(null);
    saveCopyMutation.reset();
    setSaveCopyOpen(true);
  }

  async function saveConflictCopy() {
    const targetPath = saveCopyTargetPath.trim();
    if (!saveConflict || !targetPath || saveCopyMutation.isPending) return false;
    const savingDraftKey = latestDraftKeyRef.current;
    const pending = pendingCopyIdentityRef.current;
    const identity =
      pending?.draftKey === savingDraftKey &&
      pending.targetPath === targetPath &&
      pending.baseFingerprint === fingerprint
        ? pending
        : {
            draftKey: savingDraftKey,
            targetPath,
            baseFingerprint: fingerprint,
            idempotencyKey: crypto.randomUUID(),
          };
    pendingCopyIdentityRef.current = identity;
    saveCopyMutation.reset();
    try {
      const saved = await saveCopyMutation.mutateAsync({
        sourcePath: data.path,
        targetPath,
        editorKind: data.editorKind,
        model: latestDraftRef.current,
        modelSchemaVersion: data.modelSchemaVersion,
        requiredCapabilities: requiredDocumentEditorCapabilities(data.editorKind),
        idempotencyKey: identity.idempotencyKey,
        baseFingerprint: fingerprint,
      });
      setSavedCopyPath(saved.path);
      setSaveCopyOpen(false);
      pendingCopyIdentityRef.current = null;
      return true;
    } catch {
      return false;
    }
  }

  async function reloadExternalRevision() {
    if (writeModel.isPending) return false;
    const revision = externalRevision ?? (await refreshModel?.().catch(() => null));
    if (!revision) return false;
    adoptServerRevision(revision);
    return true;
  }

  function rebaseExternalRevision() {
    if (
      !externalRevision ||
      !externalComparison ||
      externalComparison.conflictPaths.length > 0 ||
      writeModel.isPending
    ) {
      return false;
    }
    const mergedKey = `rebase:${crypto.randomUUID()}`;
    dispatchSession({
      type: "rebase",
      response: externalRevision,
      mergedModel: externalComparison.mergedModel,
      mergedKey,
    });
    compatibilityValidation.reset();
    editorHistory.reset();
    pendingSaveIdentityRef.current = null;
    autosave.clear();
    writeModel.reset();
    return true;
  }

  function restoreRecoveryDraft() {
    if (!recoveryDraft || writeModel.isPending) return false;
    const recoveredBaseKey = recoveryDraft.baseFingerprint;
    dispatchSession({
      type: "restoreRecovery",
      baseModel: recoveryDraft.baseModel,
      baseKey: recoveredBaseKey,
      baseFingerprint: recoveryDraft.baseFingerprint,
      model: recoveryDraft.model,
      key: `recovery:${recoveryDraft.id}`,
    });
    editorHistory.reset();
    autosave.clear();
    if (data.fingerprint !== recoveryDraft.baseFingerprint) {
      dispatchSession({
        type: "incomingRevision",
        response: data,
        source: "external",
      });
    }
    recovery.markRestored(recoveryDraft.id);
    return true;
  }

  function dismissRecoveryDraft() {
    recovery.dismissAvailable();
  }

  function adoptServerRevision(revision: DocumentEditorModelResponse) {
    autosave.clear();
    dispatchSession({
      type: "rebase",
      response: revision,
      mergedModel: revision.model,
      mergedKey: revision.fingerprint,
    });
    compatibilityValidation.reset();
    editorHistory.reset();
    recovery.clearAvailable();
    recovery.deleteOwnedDrafts();
    writeModel.reset();
  }

  const search = useDocumentEditorSearch(draft, commitDraft);

  async function downloadPackage() {
    if (writeModel.isPending) return;
    const saved = await save();
    if (!saved) return;
    window.location.assign(drivePackageUrl(data.path));
  }

  function openCommandPalette() {
    setCommandPaletteQuery("");
    setCommandPaletteOpen(true);
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
      search.setFindPanelOpen(true);
      return;
    }
    if (commandId === "shortcuts") {
      setShortcutHelpOpen((current) => !current);
      return;
    }
    if (commandId === "commandPalette") {
      openCommandPalette();
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

  return {
    rootRef,
    draft,
    fingerprint,
    compatibilityWarnings: compatibilityValidation.warnings,
    compatibilityValidationPending: compatibilityValidation.pending,
    compatibilityValidationError: compatibilityValidation.error,
    validatedDraftSerializedSize: compatibilityValidation.serializedSize,
    syncStatus,
    dirty,
    operationCount: editorHistory.operationCount,
    selectionSnapshot,
    lastSavedAt,
    isSaving: writeModel.isPending,
    isSaveQueued: autosave.queued,
    saveError: writeModel.isError && !saveConflict,
    saveErrorMessage:
      writeModel.isError && !saveConflict && writeModel.error instanceof Error
        ? writeModel.error.message
        : null,
    saveConflict,
    saveCopyOpen,
    saveCopyTargetPath,
    savedCopyPath,
    isSavingCopy: saveCopyMutation.isPending,
    saveCopyError:
      saveCopyMutation.isError && saveCopyMutation.error instanceof Error
        ? saveCopyMutation.error.message
        : null,
    externalRevisionAvailable: externalRevision !== null,
    externalRevisionSource,
    externalRevisionProvenance: externalRevision?.revisionProvenance ?? null,
    externalComparison,
    recoveryDraftAvailable: recoveryDraft !== null,
    recoveryError: recovery.error,
    canUndo: editorHistory.canUndo,
    canRedo: editorHistory.canRedo,
    keymapEntries,
    shortcutHelpOpen,
    commandPaletteOpen,
    commandPaletteQuery,
    findPanelOpen: search.findPanelOpen,
    findQuery: search.findQuery,
    replaceValue: search.replaceValue,
    matchCase: search.matchCase,
    wholeWord: search.wholeWord,
    regexSearch: search.regexSearch,
    matchCount: search.matchCount,
    searchError: search.searchError,
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
    setFindPanelOpen: search.setFindPanelOpen,
    setFindQuery: search.setFindQuery,
    setReplaceValue: search.setReplaceValue,
    setMatchCase: search.setMatchCase,
    setWholeWord: search.setWholeWord,
    setRegexSearch: search.setRegexSearch,
    setSaveCopyOpen,
    setSaveCopyTargetPath,
    replaceFirst: search.replaceFirst,
    replaceAll: search.replaceAll,
  };
}

export function defaultDocumentCopyPath(path: string) {
  const separator = path.lastIndexOf("/");
  const directory = separator >= 0 ? path.slice(0, separator + 1) : "";
  const name = separator >= 0 ? path.slice(separator + 1) : path;
  const extensionIndex = name.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? name.slice(0, extensionIndex) : name;
  const extension = hasExtension ? name.slice(extensionIndex) : "";
  return `${directory}${stem} (conflict copy)${extension}`;
}
