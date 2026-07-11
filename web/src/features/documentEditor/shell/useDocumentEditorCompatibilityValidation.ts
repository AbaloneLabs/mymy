import { useEffect, useState } from "react";
import { requiredDocumentEditorCapabilities } from "@/features/documentEditor/shared/capabilities";
import { validateDocumentEditorModel } from "@/features/documentEditor/shared/api";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";

interface CompatibilityValidation {
  draftKey: string;
  serializedSize: number;
  warnings: DocumentEditorModelResponse["compatibilityWarnings"];
}

/**
 * Owns draft validation as a replaceable persistence-side coordinator.
 *
 * Validation intentionally follows the immutable draft key rather than the
 * object identity. A slow response for an older edit can therefore never
 * replace warnings for the model the user is currently viewing.
 */
export function useDocumentEditorCompatibilityValidation({
  data,
  draft,
  draftKey,
  dirty,
  fingerprint,
  saveConflict,
}: {
  data: DocumentEditorModelResponse;
  draft: unknown;
  draftKey: string;
  dirty: boolean;
  fingerprint: string;
  saveConflict: boolean;
}) {
  const [validation, setValidation] = useState<CompatibilityValidation | null>(
    null,
  );
  const [validationError, setValidationError] = useState<{
    draftKey: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!dirty || saveConflict) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setValidationError(null);
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
          setValidation({
            draftKey,
            serializedSize: result.serializedSize,
            warnings: result.compatibilityWarnings,
          });
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setValidationError({
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
  }, [
    data.editorKind,
    data.modelSchemaVersion,
    data.path,
    dirty,
    draft,
    draftKey,
    fingerprint,
    saveConflict,
  ]);

  const currentValidation =
    dirty && validation?.draftKey === draftKey ? validation : null;

  return {
    warnings: currentValidation?.warnings ?? data.compatibilityWarnings,
    pending: dirty && validation?.draftKey !== draftKey,
    error:
      validationError?.draftKey === draftKey ? validationError.message : null,
    serializedSize: currentValidation?.serializedSize ?? null,
    reset() {
      setValidation(null);
      setValidationError(null);
    },
  };
}
