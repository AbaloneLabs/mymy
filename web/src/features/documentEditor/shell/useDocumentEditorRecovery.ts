import { useCallback, useEffect, useRef, useState } from "react";
import { stableJson } from "@/features/documentEditor/shared/models";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";
import {
  deleteDocumentEditorRecoveryDraft,
  documentEditorRecoveryDraftId,
  persistDocumentEditorRecoveryDraft,
  readDocumentEditorRecoveryDraft,
  type DocumentEditorRecoveryDraft,
} from "./documentEditorRecoveryDraft";

interface RecoverySnapshot {
  principalScopeId: string;
  sessionId: string;
  path: string;
  editorKind: DocumentEditorModelResponse["editorKind"];
  modelSchemaVersion: number;
  baseFingerprint: string;
  baseModel: unknown;
  model: unknown;
  dirty: boolean;
}

/**
 * Coordinates browser-owned recovery records independently from save state.
 *
 * A recovery record belongs to a tab session, not merely to a Drive path.
 * Keeping ownership and cleanup here prevents one tab from deleting another
 * tab's last recoverable draft while still allowing an acknowledged save to
 * retire only the records this session adopted.
 */
export function useDocumentEditorRecovery({
  data,
  baseModel,
  draft,
  draftKey,
  dirty,
  fingerprint,
  principalScopeId,
}: {
  data: DocumentEditorModelResponse;
  baseModel: unknown;
  draft: unknown;
  draftKey: string;
  dirty: boolean;
  fingerprint: string;
  principalScopeId: string | null;
}) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const restoredDraftIdRef = useRef<string | null>(null);
  const ignoredDraftIdsRef = useRef(new Set<string>());
  const [availableDraft, setAvailableDraft] =
    useState<DocumentEditorRecoveryDraft | null>(null);
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopePathKey = principalScopeId
    ? `${principalScopeId}\u0000${data.path}`
    : null;
  const scopedAvailableDraft =
    availableDraft?.principalScopeId === principalScopeId
      ? availableDraft
      : null;
  const snapshotRef = useRef<RecoverySnapshot>({
    principalScopeId: principalScopeId ?? "",
    sessionId,
    path: data.path,
    editorKind: data.editorKind,
    modelSchemaVersion: data.modelSchemaVersion,
    baseFingerprint: fingerprint,
    baseModel,
    model: draft,
    dirty,
  });
  const deleteCurrentSessionDraft = useCallback(() => {
    if (!principalScopeId) return;
    void deleteDocumentEditorRecoveryDraft(
      documentEditorRecoveryDraftId(principalScopeId, data.path, sessionId),
    ).catch(() => undefined);
  }, [data.path, principalScopeId, sessionId]);

  useEffect(() => {
    snapshotRef.current = {
      principalScopeId: principalScopeId ?? "",
      sessionId,
      path: data.path,
      editorKind: data.editorKind,
      modelSchemaVersion: data.modelSchemaVersion,
      baseFingerprint: fingerprint,
      baseModel,
      model: draft,
      dirty,
    };
  }, [
    baseModel,
    data.editorKind,
    data.modelSchemaVersion,
    data.path,
    dirty,
    draft,
    draftKey,
    fingerprint,
    principalScopeId,
    sessionId,
  ]);

  useEffect(() => {
    let active = true;
    restoredDraftIdRef.current = null;
    if (!principalScopeId) {
      return () => {
        active = false;
      };
    }
    void readDocumentEditorRecoveryDraft(
      principalScopeId,
      data.path,
      ignoredDraftIdsRef.current,
    )
      .then((stored) => {
        if (!active) return;
        if (
          stored?.editorKind === data.editorKind &&
          stored.modelSchemaVersion === data.modelSchemaVersion &&
          stableJson(stored.model) !== stableJson(stored.baseModel)
        ) {
          setAvailableDraft(stored);
        } else {
          setAvailableDraft(null);
        }
      })
      .catch((caught) => {
        if (active) setError(recoveryErrorMessage(caught));
      })
      .finally(() => {
        if (active) setCheckedPath(scopePathKey);
      });
    return () => {
      active = false;
    };
  }, [data.editorKind, data.modelSchemaVersion, data.path, principalScopeId, scopePathKey]);

  useEffect(() => {
    if (!principalScopeId || checkedPath !== scopePathKey) return;
    if (!dirty) {
      if (!scopedAvailableDraft) deleteCurrentSessionDraft();
      return;
    }
    const timer = window.setTimeout(() => {
      void persistSnapshot(snapshotRef.current)
        .then(() => setError(null))
        .catch((caught) => setError(recoveryErrorMessage(caught)));
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    checkedPath,
    data.path,
    deleteCurrentSessionDraft,
    dirty,
    draftKey,
    fingerprint,
    sessionId,
    principalScopeId,
    scopePathKey,
    scopedAvailableDraft,
  ]);

  useEffect(() => {
    return () => {
      const snapshot = snapshotRef.current;
      if (snapshot.dirty && snapshot.principalScopeId) {
        void persistSnapshot(snapshot).catch(() => undefined);
      }
    };
  }, []);

  function clearAvailable() {
    setAvailableDraft(null);
  }

  function dismissAvailable() {
    if (scopedAvailableDraft) {
      ignoredDraftIdsRef.current.add(scopedAvailableDraft.id);
    }
    setAvailableDraft(null);
  }

  function markRestored(id: string) {
    restoredDraftIdRef.current = id;
    setAvailableDraft(null);
  }

  function deleteOwnedDrafts() {
    if (!principalScopeId) return;
    const ids = new Set([
      documentEditorRecoveryDraftId(principalScopeId, data.path, sessionId),
    ]);
    if (restoredDraftIdRef.current) {
      ids.add(restoredDraftIdRef.current);
      restoredDraftIdRef.current = null;
    }
    ids.forEach((id) => {
      void deleteDocumentEditorRecoveryDraft(id).catch(() => undefined);
    });
  }

  function deleteRestoredDraft() {
    const id = restoredDraftIdRef.current;
    if (!id) return;
    restoredDraftIdRef.current = null;
    void deleteDocumentEditorRecoveryDraft(id).catch(() => undefined);
  }

  function persistCurrentDraft({
    baseFingerprint,
    nextBaseModel,
    model,
  }: {
    baseFingerprint: string;
    nextBaseModel: unknown;
    model: unknown;
  }) {
    if (!principalScopeId) {
      setError("Browser recovery is unavailable for this authenticated session");
      return;
    }
    void persistDocumentEditorRecoveryDraft({
      principalScopeId,
      sessionId,
      path: data.path,
      editorKind: data.editorKind,
      modelSchemaVersion: data.modelSchemaVersion,
      baseFingerprint,
      baseModel: nextBaseModel,
      model,
    }).catch((caught) => setError(recoveryErrorMessage(caught)));
  }

  return {
    sessionId,
    availableDraft: scopedAvailableDraft,
    error,
    clearAvailable,
    dismissAvailable,
    markRestored,
    deleteCurrentSessionDraft,
    deleteOwnedDrafts,
    deleteRestoredDraft,
    persistCurrentDraft,
  };
}

function persistSnapshot(snapshot: RecoverySnapshot) {
  return persistDocumentEditorRecoveryDraft({
    principalScopeId: snapshot.principalScopeId,
    sessionId: snapshot.sessionId,
    path: snapshot.path,
    editorKind: snapshot.editorKind,
    modelSchemaVersion: snapshot.modelSchemaVersion,
    baseFingerprint: snapshot.baseFingerprint,
    baseModel: snapshot.baseModel,
    model: snapshot.model,
  });
}

function recoveryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Browser recovery storage failed";
}
