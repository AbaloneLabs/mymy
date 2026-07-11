/** Stable cache identities owned by the document-editor feature facade. */
export const documentEditorQueryKeys = {
  models: ["document-editor", "model"] as const,
  model: (path: string | null) => ["document-editor", "model", path] as const,
  settings: ["editor-settings"] as const,
  fonts: ["editor-settings", "fonts"] as const,
  keymap: ["editor-settings", "keymap"] as const,
  preferences: ["editor-settings", "preferences"] as const,
};
