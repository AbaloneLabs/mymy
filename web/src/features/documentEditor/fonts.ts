import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, ApiError, api } from "@/lib/api";
import type {
  EditorFont,
  EditorFontsResponse,
  EditorFontUploadResponse,
  EditorKeymapEntry,
  EditorKeymapResponse,
  EditorPreferences,
  EditorPreferencesResponse,
} from "@/types/editorSettings";

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
    queryKey: ["editor-settings", "fonts"],
    queryFn: () => api.get<EditorFontsResponse>("/editor-settings/fonts"),
  });
}

export function useUploadEditorFonts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadEditorFonts(files),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["editor-settings", "fonts"] }),
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
      qc.invalidateQueries({ queryKey: ["editor-settings", "fonts"] }),
  });
}

export function useEditorKeymap() {
  return useQuery({
    queryKey: ["editor-settings", "keymap"],
    queryFn: () => api.get<EditorKeymapResponse>("/editor-settings/keymap"),
  });
}

export function useUpdateEditorKeymap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shortcuts: EditorKeymapEntry[]) =>
      api.put<EditorKeymapResponse>("/editor-settings/keymap", { shortcuts }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["editor-settings", "keymap"] }),
  });
}

export function useEditorPreferences() {
  return useQuery({
    queryKey: ["editor-settings", "preferences"],
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
      qc.invalidateQueries({ queryKey: ["editor-settings", "preferences"] }),
  });
}

export async function uploadEditorFonts(files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("file", file, file.name);
  }
  const res = await fetch(`${API_BASE}/editor-settings/fonts`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("mymy:unauthorized"));
    }
    const message = (data && (data.error || data.message)) || res.statusText;
    throw new ApiError(res.status, message, data);
  }
  return data as EditorFontUploadResponse;
}

export function editorFontBlobUrl(font: Pick<EditorFont, "id">) {
  return `${API_BASE}/editor-settings/fonts/${encodeURIComponent(font.id)}/blob`;
}

export function drivePackageUrl(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return `${API_BASE}/drive/download-package?${params.toString()}`;
}
