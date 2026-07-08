import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  autoPairSource,
  isPotentialSourceEditKey,
} from "./textSourceUtils";
import type { SourceEdit, TextEditorKind } from "./textSourceUtils";

interface TextSourceKeyDownOptions {
  activateRectangularSourceSelection: () => void;
  addNextSourceSelection: () => void;
  applySourceEdit: (edit: SourceEdit | null) => void;
  content: string;
  cursorLine: number;
  duplicateSelection: () => void;
  folded: boolean;
  formatJson: () => void;
  handleSourceMultiCursorKey: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => boolean;
  indentSelection: () => void;
  json: boolean;
  kind: TextEditorKind;
  minifyJson: () => void;
  moveSelection: (direction: -1 | 1) => void;
  openGoToLine: (line: number) => void;
  openSearch: () => void;
  outdentSelection: () => void;
  selectCurrentLine: () => void;
  setTableMode: () => void;
  setTreeMode: () => void;
  sortJsonKeys: () => void;
  structured: boolean;
  toggleBlockComment: () => void;
  toggleLineComment: () => void;
  togglePreviewMode: () => void;
  toggleSchema: () => void;
  unfoldAll: () => void;
}

export function handleTextSourceKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  options: TextSourceKeyDownOptions,
) {
  if (options.folded && isPotentialSourceEditKey(event)) {
    event.preventDefault();
    options.unfoldAll();
    return;
  }

  const primary = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (options.handleSourceMultiCursorKey(event)) {
    return;
  }
  if (primary && key === "d") {
    event.preventDefault();
    options.addNextSourceSelection();
  } else if (event.altKey && event.shiftKey && key === "r") {
    event.preventDefault();
    options.activateRectangularSourceSelection();
  } else if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey) options.outdentSelection();
    else options.indentSelection();
  } else if (primary && event.key === "/") {
    event.preventDefault();
    options.toggleLineComment();
  } else if (event.altKey && event.shiftKey && key === "a") {
    event.preventDefault();
    options.toggleBlockComment();
  } else if (primary && key === "[") {
    event.preventDefault();
    options.outdentSelection();
  } else if (primary && key === "]") {
    event.preventDefault();
    options.indentSelection();
  } else if (primary && key === "l") {
    event.preventDefault();
    options.selectCurrentLine();
  } else if (primary && !event.shiftKey && key === "f") {
    event.preventDefault();
    options.openSearch();
  } else if (primary && key === "h") {
    event.preventDefault();
    options.openSearch();
  } else if (primary && key === "g") {
    event.preventDefault();
    options.openGoToLine(options.cursorLine);
  } else if (event.altKey && event.shiftKey && event.key === "ArrowUp") {
    event.preventDefault();
    options.duplicateSelection();
  } else if (event.altKey && event.shiftKey && event.key === "ArrowDown") {
    event.preventDefault();
    options.duplicateSelection();
  } else if (event.altKey && event.key === "ArrowUp") {
    event.preventDefault();
    options.moveSelection(-1);
  } else if (event.altKey && event.key === "ArrowDown") {
    event.preventDefault();
    options.moveSelection(1);
  } else if (options.json && primary && event.shiftKey && key === "f") {
    event.preventDefault();
    options.formatJson();
  } else if (options.json && primary && event.shiftKey && key === "m") {
    event.preventDefault();
    options.minifyJson();
  } else if (options.json && primary && event.altKey && key === "k") {
    event.preventDefault();
    options.sortJsonKeys();
  } else if (options.json && primary && event.altKey && key === "s") {
    event.preventDefault();
    options.toggleSchema();
  } else if (options.structured && primary && event.shiftKey && key === "t") {
    event.preventDefault();
    options.setTreeMode();
  } else if (options.json && primary && event.shiftKey && key === "b") {
    event.preventDefault();
    options.setTableMode();
  } else if (primary && event.shiftKey && key === "v") {
    event.preventDefault();
    options.togglePreviewMode();
  } else if (
    autoPairSource(event, options.content, options.kind, options.applySourceEdit)
  ) {
    event.preventDefault();
  }
}

interface TextEditorKeyDownOptions {
  json: boolean;
  setTableMode: () => void;
  setTreeMode: () => void;
  structured: boolean;
  togglePreviewMode: () => void;
}

export function handleTextEditorKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: TextEditorKeyDownOptions,
) {
  if (event.defaultPrevented) return;
  const primary = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (primary && event.shiftKey && key === "v") {
    event.preventDefault();
    options.togglePreviewMode();
  } else if (options.structured && primary && event.shiftKey && key === "t") {
    event.preventDefault();
    options.setTreeMode();
  } else if (options.json && primary && event.shiftKey && key === "b") {
    event.preventDefault();
    options.setTableMode();
  }
}
