import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DocumentEditorModelResponse,
  SaveDocumentEditorCopyRequest,
  ValidateDocumentEditorModelRequest,
  ValidateDocumentEditorModelResponse,
  WriteDocumentEditorModelRequest,
} from "@/types/documentEditor";

type WriteDocumentEditorModelMutationInput = WriteDocumentEditorModelRequest & {
  syncQuery?: boolean;
};

function documentQuery(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return params.toString();
}

export function validateDocumentEditorModel(
  input: ValidateDocumentEditorModelRequest,
  signal?: AbortSignal,
) {
  return api.post<ValidateDocumentEditorModelResponse>(
    "/document-editor/validate",
    input,
    { signal },
  );
}

export function useDocumentEditorModel(path: string | null) {
  return useQuery({
    queryKey: ["document-editor", "model", path],
    enabled: Boolean(path),
    queryFn: () =>
      api.get<DocumentEditorModelResponse>(
        `/document-editor/model?${documentQuery(path ?? "/drive")}`,
      ),
  });
}

export function useWriteDocumentEditorModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WriteDocumentEditorModelMutationInput) =>
      api.put<DocumentEditorModelResponse>("/document-editor/model", {
        path: input.path,
        editorKind: input.editorKind,
        model: input.model,
        modelSchemaVersion: input.modelSchemaVersion,
        requiredCapabilities: input.requiredCapabilities,
        idempotencyKey: input.idempotencyKey,
        expectedFingerprint: input.expectedFingerprint,
      }),
    onSuccess: (data, variables) => {
      if (variables.syncQuery !== false) {
        qc.setQueryData(["document-editor", "model", data.path], data);
      }
      qc.invalidateQueries({ queryKey: ["drive", "file", data.path] });
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
    },
  });
}

export function useSaveDocumentEditorCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDocumentEditorCopyRequest) =>
      api.post<DocumentEditorModelResponse>("/document-editor/copy", input),
    onSuccess: (data) => {
      qc.setQueryData(["document-editor", "model", data.path], data);
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
    },
  });
}
