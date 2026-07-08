import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DocumentEditorModelResponse,
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
