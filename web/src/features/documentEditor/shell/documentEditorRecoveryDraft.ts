import type { DocumentEditorKind } from "@/types/documentEditor";

const DATABASE_NAME = "mymy-document-editor";
const DATABASE_VERSION = 3;
const STORE_NAME = "recovery-drafts-v3";
const LEGACY_STORE_NAMES = ["recovery-drafts", "recovery-drafts-v2"];
const SCOPE_PATH_INDEX_NAME = "principal-scope-path";
const RECOVERY_SCHEMA_VERSION = 2;

export interface DocumentEditorRecoveryDraft {
  id: string;
  principalScopeId: string;
  sessionId: string;
  schemaVersion: number;
  path: string;
  editorKind: DocumentEditorKind;
  modelSchemaVersion: number;
  baseFingerprint: string;
  baseModel: unknown;
  model: unknown;
  updatedAt: string;
}

/**
 * Persist the complete base/draft pair outside React Query state.
 *
 * The base model is deliberately stored with the draft. A recovered edit must
 * continue using the revision it was created from; rebasing it implicitly onto
 * whatever the server returns after a browser restart would turn recovery into
 * an unreviewed overwrite.
 */
export async function persistDocumentEditorRecoveryDraft(
  draft: Omit<DocumentEditorRecoveryDraft, "id" | "schemaVersion" | "updatedAt">,
) {
  const database = await openRecoveryDatabase();
  await runRecoveryRequest(
    database,
    STORE_NAME,
    "readwrite",
    (store) =>
      store.put({
        ...draft,
        id: documentEditorRecoveryDraftId(
          draft.principalScopeId,
          draft.path,
          draft.sessionId,
        ),
        schemaVersion: RECOVERY_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
      }),
  );
  database.close();
}

export async function readDocumentEditorRecoveryDraft(
  principalScopeId: string,
  path: string,
  ignoredIds: ReadonlySet<string> = new Set(),
) {
  const database = await openRecoveryDatabase();
  const values = await runRecoveryRequest(database, STORE_NAME, "readonly", (store) =>
    store
      .index(SCOPE_PATH_INDEX_NAME)
      .getAll(IDBKeyRange.only([principalScopeId, path])),
  );
  const drafts = Array.isArray(values)
    ? values
        .filter(isRecoveryDraft)
        .filter(
          (draft) =>
            draft.principalScopeId === principalScopeId &&
            !ignoredIds.has(draft.id),
        )
    : [];
  database.close();
  return latestDocumentEditorRecoveryDraft(drafts, ignoredIds);
}

export async function deleteDocumentEditorRecoveryDraft(id: string) {
  const database = await openRecoveryDatabase();
  await runRecoveryRequest(database, STORE_NAME, "readwrite", (store) =>
    store.delete(id),
  );
  database.close();
}

export async function clearDocumentEditorRecoveryDrafts() {
  const database = await openRecoveryDatabase();
  await runRecoveryRequest(database, STORE_NAME, "readwrite", (store) =>
    store.clear(),
  );
  database.close();
}

export function documentEditorRecoveryDraftId(
  principalScopeId: string,
  path: string,
  sessionId: string,
) {
  return `${principalScopeId}\u0000${path}\u0000${sessionId}`;
}

export function latestDocumentEditorRecoveryDraft(
  drafts: DocumentEditorRecoveryDraft[],
  ignoredIds: ReadonlySet<string> = new Set(),
) {
  return (
    drafts
      .filter((draft) => !ignoredIds.has(draft.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

function openRecoveryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const legacyStoreName of LEGACY_STORE_NAMES) {
        if (database.objectStoreNames.contains(legacyStoreName)) {
          database.deleteObjectStore(legacyStoreName);
        }
      }
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(
          SCOPE_PATH_INDEX_NAME,
          ["principalScopeId", "path"],
          { unique: false },
        );
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Recovery database failed"));
  });
}

function runRecoveryRequest(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    let requestResult: unknown;
    let settled = false;
    request.onsuccess = () => {
      requestResult = request.result;
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Recovery request failed"));
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(requestResult);
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("Recovery transaction failed"));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("Recovery transaction aborted"));
    };
  });
}

function isRecoveryDraft(value: unknown): value is DocumentEditorRecoveryDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DocumentEditorRecoveryDraft>;
  return (
    candidate.schemaVersion === RECOVERY_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.principalScopeId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.editorKind === "string" &&
    typeof candidate.modelSchemaVersion === "number" &&
    typeof candidate.baseFingerprint === "string" &&
    typeof candidate.updatedAt === "string" &&
    "baseModel" in candidate &&
    "model" in candidate
  );
}
