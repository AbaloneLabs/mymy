import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api } from "@/lib/api";
import type {
  EditorFont,
  EditorFontsResponse,
  EditorFontUploadResponse,
  EditorKeymapEntry,
  EditorKeymapResponse,
  EditorPreferences,
  EditorPreferencesResponse,
} from "@/types/editorSettings";
import { documentEditorQueryKeys } from "./queryKeys";

export const builtInFontFamilies = [
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
  "Noto Sans KR",
  "Noto Serif KR",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Carlito",
  "Caladea",
] as const;

export function useEditorFonts() {
  return useQuery({
    queryKey: documentEditorQueryKeys.fonts,
    queryFn: () => api.get<EditorFontsResponse>("/editor-settings/fonts"),
  });
}

export function useUploadEditorFonts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadEditorFonts(files),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: documentEditorQueryKeys.fonts }),
  });
}

export function useDeleteEditorFont() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(
        `/editor-settings/fonts/${encodeURIComponent(id)}`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: documentEditorQueryKeys.fonts }),
  });
}

export function useEditorKeymap() {
  return useQuery({
    queryKey: documentEditorQueryKeys.keymap,
    queryFn: () => api.get<EditorKeymapResponse>("/editor-settings/keymap"),
  });
}

export function useUpdateEditorKeymap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shortcuts: EditorKeymapEntry[]) =>
      api.put<EditorKeymapResponse>("/editor-settings/keymap", { shortcuts }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: documentEditorQueryKeys.keymap }),
  });
}

export function useEditorPreferences() {
  return useQuery({
    queryKey: documentEditorQueryKeys.preferences,
    queryFn: () =>
      api.get<EditorPreferencesResponse>("/editor-settings/preferences"),
  });
}

export function useUpdateEditorPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: EditorPreferences) =>
      api.put<EditorPreferencesResponse>("/editor-settings/preferences", {
        preferences,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: documentEditorQueryKeys.preferences }),
  });
}

export async function uploadEditorFonts(files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("file", file, file.name);
  }
  return api.form<EditorFontUploadResponse>("/editor-settings/fonts", form);
}

export function editorFontBlobUrl(font: Pick<EditorFont, "id">) {
  return `${API_BASE}/editor-settings/fonts/${encodeURIComponent(font.id)}/blob`;
}

export function drivePackageUrl(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return `${API_BASE}/drive/download-package?${params.toString()}`;
}
