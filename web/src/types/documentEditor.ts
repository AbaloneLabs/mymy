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
  model: unknown;
}

export interface WriteDocumentEditorModelRequest {
  path: string;
  editorKind: DocumentEditorKind;
  model: unknown;
  expectedFingerprint?: string;
}
