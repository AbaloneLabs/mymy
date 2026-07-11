import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
import { stableJson } from "@/features/documentEditor/shared/models";
import {
  countModelMatches,
  modelSearchError,
  replaceAllInModel,
  replaceFirstInModel,
} from "@/features/documentEditor/shared/search";
import {
  applyEditorOperations,
  coalesceEditorOperationEntries,
  createEditorOperationEntry,
  type EditorOperationEntry,
} from "@/features/documentEditor/shared/operationHistory";
import {
  captureEditorSelection,
  type EditorSelectionSnapshot,
} from "@/features/documentEditor/shared/selectionStore";
import {
  useSaveDocumentEditorCopy,
  useWriteDocumentEditorModel,
  validateDocumentEditorModel,
} from "@/features/documentEditor/shared/api";
import { requiredDocumentEditorCapabilities } from "@/features/documentEditor/shared/capabilities";
import { drivePackageUrl } from "@/features/drive/api";
import { ApiError } from "@/lib/api";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";
import {
  classifyIncomingDocumentRevision,
  reviewedConflictFingerprint,
} from "./documentEditorRevisionState";
import {
  deleteDocumentEditorRecoveryDraft,
  documentEditorRecoveryDraftId,
  persistDocumentEditorRecoveryDraft,
  readDocumentEditorRecoveryDraft,
  type DocumentEditorRecoveryDraft,
} from "./documentEditorRecoveryDraft";
import { compareAndMergeDocumentModels } from "./documentEditorThreeWayMerge";
import {
  publishDocumentEditorRevision,
  subscribeToDocumentEditorRevisions,
  type DocumentEditorRevisionNotice,
} from "./documentEditorRevisionChannel";

const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 5_000_000;

interface EditorHistory {
  past: EditorOperationEntry[];
  future: EditorOperationEntry[];
}

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
  const recoverySessionIdRef = useRef(crypto.randomUUID());
  const restoredRecoveryDraftIdRef = useRef<string | null>(null);
  const ignoredRecoveryDraftIdsRef = useRef(new Set<string>());
  const [draft, setDraft] = useState<unknown>(() => data.model);
  const [draftKey, setDraftKey] = useState(() => data.fingerprint);
  const [baseModel, setBaseModel] = useState<unknown>(() => data.model);
  const [baseKey, setBaseKey] = useState(() => data.fingerprint);
  const [fingerprint, setFingerprint] = useState(() => data.fingerprint);
  const [compatibilityWarnings, setCompatibilityWarnings] = useState(
    () => data.compatibilityWarnings,
  );
  const [draftCompatibilityValidation, setDraftCompatibilityValidation] =
    useState<{
      draftKey: string;
      serializedSize: number;
      warnings: DocumentEditorModelResponse["compatibilityWarnings"];
    } | null>(null);
  const [compatibilityValidationError, setCompatibilityValidationError] =
    useState<{ draftKey: string; message: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState(data.syncStatus);
  const [externalRevision, setExternalRevision] =
    useState<DocumentEditorModelResponse | null>(null);
  const [externalRevisionSource, setExternalRevisionSource] = useState<
    "another-tab" | "external" | null
  >(null);
  const [recoveryDraft, setRecoveryDraft] =
    useState<DocumentEditorRecoveryDraft | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveCopyOpen, setSaveCopyOpen] = useState(false);
  const [saveCopyTargetPath, setSaveCopyTargetPath] = useState(() =>
    defaultDocumentCopyPath(data.path),
  );
  const [savedCopyPath, setSavedCopyPath] = useState<string | null>(null);
  const [saveQueued, setSaveQueued] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [editorCommandRequest, setEditorCommandRequest] =
    useState<EditorCommandRequest | null>(null);
  const [selectionSnapshot, setSelectionSnapshot] =
    useState<EditorSelectionSnapshot>(() => ({ kind: "none", label: "No selection" }));
  const [history, setHistory] = useState<EditorHistory>({
    past: [],
    future: [],
  });
  const latestDraftRef = useRef(draft);
  const latestDraftKeyRef = useRef(draftKey);
  const saveQueuedRef = useRef(false);
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
  const recoverySnapshotRef = useRef({
    sessionId: recoverySessionIdRef.current,
    path: data.path,
    editorKind: data.editorKind,
    modelSchemaVersion: data.modelSchemaVersion,
    baseFingerprint: fingerprint,
    baseModel,
    model: draft,
    dirty: false,
  });
  latestDraftRef.current = draft;
  latestDraftKeyRef.current = draftKey;
  const dirty = draftKey !== baseKey;
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
  const validatedDraftCompatibility =
    dirty && draftCompatibilityValidation?.draftKey === draftKey
      ? draftCompatibilityValidation
      : null;
  const displayedCompatibilityWarnings =
    validatedDraftCompatibility?.warnings ?? compatibilityWarnings;
  const compatibilityValidationPending =
    dirty && draftCompatibilityValidation?.draftKey !== draftKey;
  recoverySnapshotRef.current = {
    sessionId: recoverySessionIdRef.current,
    path: data.path,
    editorKind: data.editorKind,
    modelSchemaVersion: data.modelSchemaVersion,
    baseFingerprint: fingerprint,
    baseModel,
    model: draft,
    dirty,
  };
  const matchCount = countModelMatches(draft, {
    query: findQuery,
    matchCase,
    wholeWord,
    regexSearch,
  });
  const searchError = modelSearchError({
    query: findQuery,
    matchCase,
    wholeWord,
    regexSearch,
  });
  const runAutosave = useEffectEvent(() => {
    void save();
  });
  const runQueuedSave = useEffectEvent(() => {
    if (!saveQueuedRef.current || writeModel.isPending || saveConflict) return;
    saveQueuedRef.current = false;
    setSaveQueued(false);
    void save();
  });
  const updateSelectionSnapshot = useEffectEvent(() => {
    setSelectionSnapshot(captureEditorSelection(rootRef.current, data.editorKind));
  });
  const observeIncomingRevision = useEffectEvent(
    (incoming: DocumentEditorModelResponse) => {
      const disposition = classifyIncomingDocumentRevision({
        acceptedFingerprint: fingerprint,
        incomingFingerprint: incoming.fingerprint,
        dirty,
        saving: writeModel.isPending,
      });
      if (disposition === "same") {
        if (externalRevision?.fingerprint === incoming.fingerprint) {
          setExternalRevisionSource(null);
        }
        setExternalRevision((current) =>
          current?.fingerprint === incoming.fingerprint ? null : current,
        );
        return;
      }
      if (disposition === "pin-external") {
        setExternalRevision(incoming);
        setExternalRevisionSource((current) => current ?? "external");
        return;
      }
      adoptServerRevision(incoming);
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
        notice.sourceSessionId === recoverySessionIdRef.current ||
        notice.fingerprint === fingerprint ||
        !refreshModel
      ) {
        return;
      }
      void refreshModel()
        .then((incoming) => {
          if (!incoming || incoming.fingerprint !== notice.fingerprint) return;
          setExternalRevisionSource("another-tab");
          observeIncomingRevision(incoming);
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
    let active = true;
    restoredRecoveryDraftIdRef.current = null;
    void readDocumentEditorRecoveryDraft(
      data.path,
      ignoredRecoveryDraftIdsRef.current,
    )
      .then((stored) => {
        if (!active) return;
        if (
          stored?.editorKind === data.editorKind &&
          stored.modelSchemaVersion === data.modelSchemaVersion &&
          stableJson(stored.model) !== stableJson(stored.baseModel)
        ) {
          setRecoveryDraft(stored);
        } else {
          setRecoveryDraft(null);
        }
      })
      .catch((error) => {
        if (active) setRecoveryError(recoveryErrorMessage(error));
      })
      .finally(() => {
        if (active) setRecoveryChecked(true);
      });
    return () => {
      active = false;
    };
  }, [data.editorKind, data.modelSchemaVersion, data.path]);

  useEffect(() => {
    if (!recoveryChecked) return;
    if (!dirty) {
      if (!recoveryDraft) {
        void deleteDocumentEditorRecoveryDraft(
          documentEditorRecoveryDraftId(
            data.path,
            recoverySessionIdRef.current,
          ),
        ).catch(() => undefined);
      }
      return;
    }
    const timer = window.setTimeout(() => {
      const snapshot = recoverySnapshotRef.current;
      void persistDocumentEditorRecoveryDraft({
        sessionId: snapshot.sessionId,
        path: snapshot.path,
        editorKind: snapshot.editorKind,
        modelSchemaVersion: snapshot.modelSchemaVersion,
        baseFingerprint: snapshot.baseFingerprint,
        baseModel: snapshot.baseModel,
        model: snapshot.model,
      })
        .then(() => setRecoveryError(null))
        .catch((error) => setRecoveryError(recoveryErrorMessage(error)));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [data.path, dirty, draftKey, fingerprint, recoveryChecked, recoveryDraft]);

  useEffect(() => {
    return () => {
      const snapshot = recoverySnapshotRef.current;
      if (!snapshot.dirty) return;
      void persistDocumentEditorRecoveryDraft({
        sessionId: snapshot.sessionId,
        path: snapshot.path,
        editorKind: snapshot.editorKind,
        modelSchemaVersion: snapshot.modelSchemaVersion,
        baseFingerprint: snapshot.baseFingerprint,
        baseModel: snapshot.baseModel,
        model: snapshot.model,
      }).catch(() => undefined);
    };
  }, []);

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

  useEffect(() => {
    if (!autosaveEnabled || !dirty || writeModel.isPending || saveConflict) return;
    const timer = window.setTimeout(() => {
      runAutosave();
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    autosaveDelayMs,
    autosaveEnabled,
    dirty,
    draftKey,
    saveConflict,
    writeModel.isPending,
  ]);

  useEffect(() => {
    if (writeModel.isPending || !dirty || saveConflict) return;
    runQueuedSave();
  }, [dirty, draftKey, saveConflict, writeModel.isPending]);

  useEffect(() => {
    if (!dirty || saveConflict) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCompatibilityValidationError(null);
      void validateDocumentEditorModel(
        {
          path: data.path,
          editorKind: data.editorKind,
          model: draft,
          modelSchemaVersion: data.modelSchemaVersion,
          requiredCapabilities: requiredDocumentEditorCapabilities(data.editorKind),
          expectedFingerprint: fingerprint,
        },
        controller.signal,
      )
        .then((result) => {
          setDraftCompatibilityValidation({
            draftKey,
            serializedSize: result.serializedSize,
            warnings: result.compatibilityWarnings,
          });
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setCompatibilityValidationError({
            draftKey,
            message:
              error instanceof Error ? error.message : "Draft validation failed",
          });
        });
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [data.editorKind, data.modelSchemaVersion, data.path, dirty, draft, draftKey, fingerprint, saveConflict]);

  function commitDraft(next: unknown) {
    const operation = createEditorOperationEntry({
      before: draft,
      after: next,
      label: "Edit document model",
    });
    if (!operation) return;
    const nextKey = `local:${operation.id}`;
    operation.beforeRevisionKey = draftKey;
    operation.afterRevisionKey = nextKey;
    const previous = history.past.at(-1);
    const previewCoalesced = previous
      ? coalesceEditorOperationEntries(previous, operation)
      : undefined;
    const committedKey =
      previewCoalesced === null
        ? (previous?.beforeRevisionKey ?? nextKey)
        : nextKey;
    setSaveConflict(false);
    writeModel.reset();
    if (writeModel.isPending) queueSave();
    setHistory((current) => {
      const currentPrevious = current.past.at(-1);
      const coalesced = currentPrevious
        ? coalesceEditorOperationEntries(currentPrevious, operation)
        : undefined;
      const past =
        coalesced === undefined
          ? [...current.past, operation]
          : coalesced === null
            ? current.past.slice(0, -1)
            : [...current.past.slice(0, -1), coalesced];
      return { past: trimHistoryEntries(past), future: [] };
    });
    setDraft(next);
    setDraftKey(committedKey);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (previous === undefined) return;
    const restored = applyEditorOperations(draft, previous.inverse);
    setHistory({
      past: history.past.slice(0, -1),
      future: trimHistoryEntries(
        [previous, ...history.future],
        "start",
      ),
    });
    setSaveConflict(false);
    setDraft(restored);
    setDraftKey(previous.beforeRevisionKey ?? `undo:${previous.id}`);
  }

  function redo() {
    const next = history.future[0];
    if (next === undefined) return;
    const restored = applyEditorOperations(draft, next.forward);
    setHistory({
      past: trimHistoryEntries([...history.past, next]),
      future: history.future.slice(1),
    });
    setSaveConflict(false);
    setDraft(restored);
    setDraftKey(next.afterRevisionKey ?? `redo:${next.id}`);
  }

  function replaceFirst() {
    const result = replaceFirstInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  function replaceAll() {
    const result = replaceAllInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  async function save(options: { expectedFingerprint?: string } = {}) {
    if (writeModel.isPending) {
      if (dirty) queueSave();
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
    setSaveConflict(false);
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
      setSaveConflict(false);
      clearQueuedSave();
      setFingerprint(saved.fingerprint);
      setBaseModel(saved.model);
      setBaseKey(savedKey);
      setCompatibilityWarnings(saved.compatibilityWarnings);
      setDraftCompatibilityValidation(null);
      setCompatibilityValidationError(null);
      setSyncStatus(saved.syncStatus);
      setExternalRevision(null);
      setExternalRevisionSource(null);
      setLastSavedAt(new Date().toLocaleTimeString());
      setRecoveryDraft(null);
      if (pendingSaveIdentityRef.current === saveIdentity) {
        pendingSaveIdentityRef.current = null;
      }
      publishDocumentEditorRevision({
        path: data.path,
        fingerprint: saved.fingerprint,
        sourceSessionId: recoverySessionIdRef.current,
      });
      if (latestDraftKeyRef.current === savingDraftKey) {
        deleteOwnedRecoveryDrafts();
        setDraft(saved.model);
        setDraftKey(savedKey);
        return true;
      }
      deleteRestoredRecoveryDraft();
      void persistDocumentEditorRecoveryDraft({
        sessionId: recoverySessionIdRef.current,
        path: data.path,
        editorKind: data.editorKind,
        modelSchemaVersion: data.modelSchemaVersion,
        baseFingerprint: saved.fingerprint,
        baseModel: saved.model,
        model: latestDraftRef.current,
      }).catch((error) => setRecoveryError(recoveryErrorMessage(error)));
      queueSave();
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveConflict(true);
        clearQueuedSave();
        const refreshed = await refreshModel?.().catch(() => null);
        if (refreshed && refreshed.fingerprint !== fingerprint) {
          setExternalRevision(refreshed);
          setExternalRevisionSource("external");
        }
        return false;
      }
      setSaveConflict(false);
      // A second explicit save made while the first request was pending is a
      // real follow-up intent. Preserve that one retry after a transport
      // failure, while successful and conflict transitions clear both the UI
      // flag and the authoritative ref so it cannot leak into a later edit.
      setSaveQueued(saveQueuedRef.current);
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
    const externalKey = externalRevision.fingerprint;
    const mergedKey = `rebase:${crypto.randomUUID()}`;
    setBaseModel(externalRevision.model);
    setBaseKey(externalKey);
    setFingerprint(externalRevision.fingerprint);
    setCompatibilityWarnings(externalRevision.compatibilityWarnings);
    setDraftCompatibilityValidation(null);
    setCompatibilityValidationError(null);
    setSyncStatus(externalRevision.syncStatus);
    setDraft(externalComparison.mergedModel);
    setDraftKey(mergedKey);
    setHistory({ past: [], future: [] });
    setSaveConflict(false);
    setExternalRevision(null);
    setExternalRevisionSource(null);
    pendingSaveIdentityRef.current = null;
    clearQueuedSave();
    writeModel.reset();
    return true;
  }

  function restoreRecoveryDraft() {
    if (!recoveryDraft || writeModel.isPending) return false;
    const recoveredBaseKey = recoveryDraft.baseFingerprint;
    setBaseModel(recoveryDraft.baseModel);
    setBaseKey(recoveredBaseKey);
    setFingerprint(recoveryDraft.baseFingerprint);
    setDraft(recoveryDraft.model);
    setDraftKey(`recovery:${recoveryDraft.id}`);
    setHistory({ past: [], future: [] });
    setSaveConflict(false);
    clearQueuedSave();
    if (data.fingerprint !== recoveryDraft.baseFingerprint) {
      setExternalRevision(data);
      setExternalRevisionSource("external");
    }
    restoredRecoveryDraftIdRef.current = recoveryDraft.id;
    setRecoveryDraft(null);
    return true;
  }

  function dismissRecoveryDraft() {
    if (recoveryDraft) {
      // Dismissing in this tab must not delete a recovery record that may
      // still belong to another live tab editing the same path.
      ignoredRecoveryDraftIdsRef.current.add(recoveryDraft.id);
    }
    setRecoveryDraft(null);
  }

  function adoptServerRevision(revision: DocumentEditorModelResponse) {
    const revisionKey = revision.fingerprint;
    saveQueuedRef.current = false;
    setSaveQueued(false);
    setSaveConflict(false);
    setExternalRevision(null);
    setExternalRevisionSource(null);
    setFingerprint(revision.fingerprint);
    setBaseModel(revision.model);
    setBaseKey(revisionKey);
    setDraft(revision.model);
    setDraftKey(revisionKey);
    setCompatibilityWarnings(revision.compatibilityWarnings);
    setDraftCompatibilityValidation(null);
    setCompatibilityValidationError(null);
    setSyncStatus(revision.syncStatus);
    setHistory({ past: [], future: [] });
    setRecoveryDraft(null);
    deleteOwnedRecoveryDrafts();
    writeModel.reset();
  }

  function deleteOwnedRecoveryDrafts() {
    const ids = new Set([
      documentEditorRecoveryDraftId(data.path, recoverySessionIdRef.current),
    ]);
    if (restoredRecoveryDraftIdRef.current) {
      ids.add(restoredRecoveryDraftIdRef.current);
      restoredRecoveryDraftIdRef.current = null;
    }
    ids.forEach((id) => {
      void deleteDocumentEditorRecoveryDraft(id).catch(() => undefined);
    });
  }

  function deleteRestoredRecoveryDraft() {
    const id = restoredRecoveryDraftIdRef.current;
    if (!id) return;
    restoredRecoveryDraftIdRef.current = null;
    void deleteDocumentEditorRecoveryDraft(id).catch(() => undefined);
  }

  function queueSave() {
    saveQueuedRef.current = true;
    setSaveQueued(true);
  }

  function clearQueuedSave() {
    saveQueuedRef.current = false;
    setSaveQueued(false);
  }

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
      setFindPanelOpen(true);
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
    compatibilityWarnings: displayedCompatibilityWarnings,
    compatibilityValidationPending,
    compatibilityValidationError:
      compatibilityValidationError?.draftKey === draftKey
        ? compatibilityValidationError.message
        : null,
    validatedDraftSerializedSize: validatedDraftCompatibility?.serializedSize ?? null,
    syncStatus,
    dirty,
    operationCount: history.past.length,
    selectionSnapshot,
    lastSavedAt,
    isSaving: writeModel.isPending,
    isSaveQueued: saveQueued,
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
    recoveryError,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
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
  };
}

function recoveryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Browser recovery storage failed";
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

function trimHistoryEntries(
  entries: EditorOperationEntry[],
  keep: "end" | "start" = "end",
) {
  const next =
    keep === "end"
      ? entries.slice(-MAX_HISTORY_ENTRIES)
      : entries.slice(0, MAX_HISTORY_ENTRIES);
  let totalSize = next.reduce((sum, entry) => sum + entry.size, 0);
  while (next.length > 1 && totalSize > MAX_HISTORY_BYTES) {
    const removed = keep === "end" ? next.shift() : next.pop();
    totalSize -= removed?.size ?? 0;
  }
  return next;
}
