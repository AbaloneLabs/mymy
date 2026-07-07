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
  compatibilityWarnings: DocumentCompatibilityWarning[];
  model: unknown;
}

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
  expectedFingerprint?: string;
}
