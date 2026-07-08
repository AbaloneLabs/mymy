import { useState } from "react";
import {
  useDeleteEditorFont,
  useEditorFonts,
  useEditorKeymap,
  useEditorPreferences,
  useUpdateEditorKeymap,
  useUpdateEditorPreferences,
  useUploadEditorFonts,
} from "@/features/documentEditor/shared/fonts";
import type { DocumentEditorKind } from "@/types/documentEditor";
import { EditorFontSettingsSection } from "./EditorFontSettingsSection";
import { EditorKeymapSection } from "./EditorKeymapSettingsSection";
import { EditorPreferencesSection } from "./EditorPreferencesSettingsSection";

export function EditorSettingsSection() {
  const fonts = useEditorFonts();
  const uploadFonts = useUploadEditorFonts();
  const deleteFont = useDeleteEditorFont();
  const keymap = useEditorKeymap();
  const updateKeymap = useUpdateEditorKeymap();
  const preferences = useEditorPreferences();
  const updatePreferences = useUpdateEditorPreferences();
  const [selectedKind, setSelectedKind] = useState<DocumentEditorKind>("text");

  return (
    <div className="space-y-6">
      <EditorPreferencesSection
        loading={preferences.isLoading}
        error={preferences.isError}
        saving={updatePreferences.isPending}
        preferences={preferences.data?.preferences ?? null}
        onSave={(next) => updatePreferences.mutate(next)}
      />

      <EditorFontSettingsSection
        customFonts={fonts.data?.fonts ?? []}
        loading={fonts.isLoading}
        uploading={uploadFonts.isPending}
        uploadError={uploadFonts.isError}
        deleting={deleteFont.isPending}
        onUploadFonts={(files, onSettled) => uploadFonts.mutate(files, { onSettled })}
        onDeleteFont={(fontId) => deleteFont.mutate(fontId)}
      />

      <EditorKeymapSection
        selectedKind={selectedKind}
        onSelectedKindChange={setSelectedKind}
        keymapEntries={keymap.data?.shortcuts ?? []}
        loading={keymap.isLoading}
        saving={updateKeymap.isPending}
        onSave={(shortcuts) => updateKeymap.mutate(shortcuts)}
      />
    </div>
  );
}
