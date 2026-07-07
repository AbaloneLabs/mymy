export interface EditorFont {
  id: string;
  displayName: string;
  familyName: string;
  subfamilyName?: string | null;
  fullName?: string | null;
  postscriptName?: string | null;
  version?: string | null;
  license?: string | null;
  licenseUrl?: string | null;
  weightClass?: number | null;
  widthClass?: number | null;
  embedding?: string | null;
  supportedScripts: string[];
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt?: string | null;
  url: string;
}

export interface EditorFontsResponse {
  fonts: EditorFont[];
}

export interface EditorFontUploadResponse {
  success: boolean;
  fonts: EditorFont[];
}

export interface EditorKeymapShortcut {
  key: string;
  display: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
}

export interface EditorKeymapEntry {
  editorKind: string;
  commandId: string;
  shortcut: EditorKeymapShortcut;
}

export interface EditorKeymapResponse {
  shortcuts: EditorKeymapEntry[];
}
