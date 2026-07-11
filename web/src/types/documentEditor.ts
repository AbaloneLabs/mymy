export type DocumentEditorKind =
  | "markdown"
  | "text"
  | "csv"
  | "tsv"
  | "docx"
  | "xlsx"
  | "pptx"
  | "preview";

export interface DocumentEditorModelResponse {
  path: string;
  name: string;
  editorKind: DocumentEditorKind;
  mimeType: string;
  fingerprint: string;
  modelSchemaVersion: number;
  capabilities: string[];
  syncStatus: DocumentEditorSyncStatus;
  revisionProvenance?: DocumentRevisionProvenance;
  compatibilityWarnings: DocumentCompatibilityWarning[];
  model: unknown;
}

export type DocumentRevisionActorKind = "user" | "agent" | "system";

export interface DocumentRevisionProvenance {
  actorKind: DocumentRevisionActorKind;
  actorId?: string;
  source: string;
  createdAt: string;
}

export type DocumentEditorSyncStatus =
  | "localOnly"
  | "pending"
  | "synced"
  | "failed";

export type DocumentCompatibilityWarningSeverity = "info" | "warning" | "danger";

export interface DocumentCompatibilityWarning {
  code: string;
  severity: DocumentCompatibilityWarningSeverity;
  message: string;
}

export interface WriteDocumentEditorModelRequest {
  path: string;
  editorKind: DocumentEditorKind;
  model: unknown;
  modelSchemaVersion: number;
  requiredCapabilities: string[];
  idempotencyKey: string;
  expectedFingerprint: string;
}

export interface SaveDocumentEditorCopyRequest {
  sourcePath: string;
  targetPath: string;
  editorKind: DocumentEditorKind;
  model: unknown;
  modelSchemaVersion: number;
  requiredCapabilities: string[];
  idempotencyKey: string;
  baseFingerprint: string;
}

export interface ValidateDocumentEditorModelRequest {
  path: string;
  editorKind: DocumentEditorKind;
  model: unknown;
  modelSchemaVersion: number;
  requiredCapabilities: string[];
  expectedFingerprint: string;
}

export interface ValidateDocumentEditorModelResponse {
  fingerprint: string;
  serializedSize: number;
  compatibilityWarnings: DocumentCompatibilityWarning[];
}
