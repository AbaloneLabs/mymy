import type { DocumentEditorModelResponse } from "@/types/documentEditor";

export type ExternalRevisionSource = "another-tab" | "external";

export interface DocumentEditorSessionState {
  serverModel: unknown;
  serverKey: string;
  acceptedFingerprint: string;
  currentModel: unknown;
  currentKey: string;
  inFlightSave: {
    snapshotKey: string;
    expectedFingerprint: string;
  } | null;
  externalRevision: DocumentEditorModelResponse | null;
  externalRevisionSource: ExternalRevisionSource | null;
  compatibilityWarnings: DocumentEditorModelResponse["compatibilityWarnings"];
  syncStatus: DocumentEditorModelResponse["syncStatus"];
  saveConflict: boolean;
}

export type DocumentEditorSessionAction =
  | { type: "localDraft"; model: unknown; key: string }
  | { type: "saveStarted"; snapshotKey: string; expectedFingerprint: string }
  | {
      type: "saveSucceeded";
      snapshotKey: string;
      response: DocumentEditorModelResponse;
    }
  | { type: "saveFailed"; conflict: boolean }
  | {
      type: "incomingRevision";
      response: DocumentEditorModelResponse;
      source: ExternalRevisionSource;
    }
  | {
      type: "rebase";
      response: DocumentEditorModelResponse;
      mergedModel: unknown;
      mergedKey: string;
    }
  | {
      type: "restoreRecovery";
      baseModel: unknown;
      baseKey: string;
      baseFingerprint: string;
      model: unknown;
      key: string;
    }
  | { type: "clearExternalRevision" }
  | { type: "clearConflict" };

export function createDocumentEditorSessionState(
  data: DocumentEditorModelResponse,
): DocumentEditorSessionState {
  return {
    serverModel: data.model,
    serverKey: data.fingerprint,
    acceptedFingerprint: data.fingerprint,
    currentModel: data.model,
    currentKey: data.fingerprint,
    inFlightSave: null,
    externalRevision: null,
    externalRevisionSource: null,
    compatibilityWarnings: data.compatibilityWarnings,
    syncStatus: data.syncStatus,
    saveConflict: false,
  };
}

/**
 * Reduce editor persistence state without browser, query, or React effects.
 *
 * The server-confirmed model and the current local model are intentionally
 * separate. A save acknowledgement advances only the submitted snapshot; it
 * cannot clear edits made while that request was in flight. Incoming server
 * revisions are adopted only when the local branch is clean, otherwise they
 * are pinned for explicit recovery or rebase.
 */
export function documentEditorSessionReducer(
  state: DocumentEditorSessionState,
  action: DocumentEditorSessionAction,
): DocumentEditorSessionState {
  switch (action.type) {
    case "localDraft":
      return {
        ...state,
        currentModel: action.model,
        currentKey: action.key,
        saveConflict: false,
      };
    case "saveStarted":
      return {
        ...state,
        inFlightSave: {
          snapshotKey: action.snapshotKey,
          expectedFingerprint: action.expectedFingerprint,
        },
        saveConflict: false,
      };
    case "saveSucceeded": {
      const hasPostSnapshotEdits = state.currentKey !== action.snapshotKey;
      return {
        ...state,
        serverModel: action.response.model,
        serverKey: action.snapshotKey,
        acceptedFingerprint: action.response.fingerprint,
        currentModel: hasPostSnapshotEdits
          ? state.currentModel
          : action.response.model,
        currentKey: hasPostSnapshotEdits ? state.currentKey : action.snapshotKey,
        inFlightSave: null,
        externalRevision: null,
        externalRevisionSource: null,
        compatibilityWarnings: action.response.compatibilityWarnings,
        syncStatus: action.response.syncStatus,
        saveConflict: false,
      };
    }
    case "saveFailed":
      return {
        ...state,
        inFlightSave: null,
        saveConflict: action.conflict,
      };
    case "incomingRevision": {
      if (action.response.fingerprint === state.acceptedFingerprint) {
        return state.externalRevision?.fingerprint === action.response.fingerprint
          ? {
              ...state,
              externalRevision: null,
              externalRevisionSource: null,
            }
          : state;
      }
      const dirty = state.currentKey !== state.serverKey;
      if (dirty || state.inFlightSave !== null) {
        return {
          ...state,
          externalRevision: action.response,
          externalRevisionSource: state.externalRevisionSource ?? action.source,
        };
      }
      return adoptRevision(state, action.response);
    }
    case "rebase":
      return {
        ...state,
        serverModel: action.response.model,
        serverKey: action.response.fingerprint,
        acceptedFingerprint: action.response.fingerprint,
        currentModel: action.mergedModel,
        currentKey: action.mergedKey,
        inFlightSave: null,
        externalRevision: null,
        externalRevisionSource: null,
        compatibilityWarnings: action.response.compatibilityWarnings,
        syncStatus: action.response.syncStatus,
        saveConflict: false,
      };
    case "restoreRecovery":
      return {
        ...state,
        serverModel: action.baseModel,
        serverKey: action.baseKey,
        acceptedFingerprint: action.baseFingerprint,
        currentModel: action.model,
        currentKey: action.key,
        inFlightSave: null,
        saveConflict: false,
      };
    case "clearExternalRevision":
      return {
        ...state,
        externalRevision: null,
        externalRevisionSource: null,
      };
    case "clearConflict":
      return { ...state, saveConflict: false };
  }
  return state;
}

function adoptRevision(
  state: DocumentEditorSessionState,
  response: DocumentEditorModelResponse,
): DocumentEditorSessionState {
  return {
    ...state,
    serverModel: response.model,
    serverKey: response.fingerprint,
    acceptedFingerprint: response.fingerprint,
    currentModel: response.model,
    currentKey: response.fingerprint,
    inFlightSave: null,
    externalRevision: null,
    externalRevisionSource: null,
    compatibilityWarnings: response.compatibilityWarnings,
    syncStatus: response.syncStatus,
    saveConflict: false,
  };
}
