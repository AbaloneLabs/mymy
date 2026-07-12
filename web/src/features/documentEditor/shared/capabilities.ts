import type { DocumentEditorKind } from "@/types/documentEditor";

const COMMON_DOCUMENT_EDITOR_CAPABILITIES = [
  "document-revision-cas-v1",
  "document-revision-provenance-v1",
  "document-conflict-copy-v1",
  "document-revision-snapshot-v1",
  "atomic-file-replace-v1",
  "normalized-model-schema-v1",
  "document-capability-matrix-v1",
];

export function requiredDocumentEditorCapabilities(kind: DocumentEditorKind) {
  const kindCapability =
    kind === "markdown"
      ? "markdown-source-model-v1"
      : kind === "text"
        ? "text-source-model-v1"
        : kind === "csv" || kind === "tsv"
          ? "delimited-table-model-v1"
          : kind === "docx"
            ? "docx-run-model-v1"
            : kind === "xlsx"
              ? "xlsx-workbook-model-v1"
              : kind === "pptx"
                ? "pptx-stable-object-model-v1"
                : "preview-read-only-v1";
  return [...COMMON_DOCUMENT_EDITOR_CAPABILITIES, kindCapability];
}

export function missingDocumentEditorCapabilities(
  kind: DocumentEditorKind,
  supported: string[] | undefined,
) {
  const available = new Set(supported ?? []);
  return requiredDocumentEditorCapabilities(kind).filter(
    (capability) => !available.has(capability),
  );
}
