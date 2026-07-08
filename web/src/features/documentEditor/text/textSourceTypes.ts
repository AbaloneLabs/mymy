export type TextEditorKind = "json" | "yaml" | "toml" | "code" | "text";
export type TextEditorMode = "source" | "tree" | "table" | "preview";

export interface SourceEdit {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface SourceSelectionRange {
  start: number;
  end: number;
}

export interface SourceSelectionLineFragment {
  line: number;
  startColumn: number;
  endColumn: number;
  caret: boolean;
}

export interface SourceBracketPairFragment {
  line: number;
  column: number;
  level: number;
  matched: boolean;
}

export interface SourceMultiCursorEdit {
  content: string;
  ranges: SourceSelectionRange[];
  primaryRange: SourceSelectionRange;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexSearch: boolean;
}

export interface ChunkedSourcePasteOptions {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  pastedText: string;
  chunkSize?: number;
  onChunk: (edit: SourceEdit, progress: SourceAsyncProgress) => void;
  onDone?: (edit: SourceEdit) => void;
}

export interface SourceAsyncProgress {
  processed: number;
  total: number;
}

export interface ChunkedSearchCountOptions extends SearchOptions {
  content: string;
  query: string;
  chunkSize?: number;
  onProgress?: (progress: SourceAsyncProgress & { count: number }) => void;
  onDone: (count: number) => void;
}

export interface ChunkedSearchRangeOptions extends SearchOptions {
  content: string;
  query: string;
  start: number;
  chunkSize?: number;
  onProgress?: (progress: SourceAsyncProgress) => void;
  onDone: (range: SourceSelectionRange | null) => void;
}

export interface SourceOutlineItem {
  line: number;
  kind: string;
  label: string;
}

export interface SourceFoldRange {
  id: string;
  startLine: number;
  endLine: number;
  label: string;
}

export interface SourceVisibleLine {
  line: number;
  text: string;
  foldId?: string;
  hiddenLineCount?: number;
}

export interface SourceMinimapLine {
  line: number;
  text: string;
}

export type SourceBracketMatch =
  | {
      matched: true;
      open: SourceBracketPosition;
      close: SourceBracketPosition;
    }
  | {
      matched: false;
      focus: SourceBracketPosition;
    };

export interface SourceBracketPosition {
  char: string;
  line: number;
  column: number;
}
