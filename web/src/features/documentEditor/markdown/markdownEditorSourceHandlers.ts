import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import {
  indentMarkdownLine,
  isMarkdownHeadingKey,
  isMarkdownUrl,
  outdentMarkdownLine,
} from "./markdownEditorUtils";
import type { MarkdownHeadingLevel } from "./markdownEditorUtils";
import {
  autoPairSource,
  isPotentialSourceEditKey,
} from "../text";
import type { SourceEdit } from "../text";

interface MarkdownSourceKeyDownOptions {
  folded: boolean;
  content: string;
  cursorLine: number;
  addNextSourceSelection: () => void;
  activateRectangularSourceSelection: () => void;
  applyBlockquote: () => void;
  applyInlineCode: () => void;
  applySourceEdit: (edit: SourceEdit | null) => void;
  applySourceHeading: (level: MarkdownHeadingLevel) => void;
  handleSourceMultiCursorKey: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => boolean;
  insertCodeBlock: () => void;
  insertMarkdownTable: () => void;
  insertTableOfContents: () => void;
  insertTaskList: () => void;
  openGoToLine: (line: number) => void;
  openImageInput: () => void;
  openSearch: () => void;
  toggleOutlinePanel: () => void;
  togglePreview: () => void;
  transformSelectedSourceLines: (transform: (line: string) => string) => void;
  unfoldAll: () => void;
  updateCursor: () => void;
  wrapSourceSelection: (before: string, after?: string) => void;
}

export function handleMarkdownSourceKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  options: MarkdownSourceKeyDownOptions,
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
    options.transformSelectedSourceLines(
      event.shiftKey ? outdentMarkdownLine : indentMarkdownLine,
    );
  } else if (primary && key === "b") {
    event.preventDefault();
    options.wrapSourceSelection("**");
  } else if (primary && key === "f") {
    event.preventDefault();
    options.openSearch();
  } else if (primary && key === "h") {
    event.preventDefault();
    options.openSearch();
  } else if (primary && key === "g") {
    event.preventDefault();
    options.openGoToLine(options.cursorLine);
  } else if (primary && event.shiftKey && key === "i") {
    event.preventDefault();
    options.openImageInput();
  } else if (primary && key === "i") {
    event.preventDefault();
    options.wrapSourceSelection("*");
  } else if (primary && key === "k") {
    event.preventDefault();
    options.wrapSourceSelection("[", "](url)");
  } else if (primary && event.shiftKey && key === "9") {
    event.preventDefault();
    options.insertTaskList();
  } else if (primary && event.shiftKey && (key === "." || key === ">")) {
    event.preventDefault();
    options.applyBlockquote();
  } else if (primary && key === "e") {
    event.preventDefault();
    options.applyInlineCode();
  } else if (primary && event.altKey && key === "c") {
    event.preventDefault();
    options.insertCodeBlock();
  } else if (primary && event.altKey && key === "t") {
    event.preventDefault();
    options.insertMarkdownTable();
  } else if (primary && event.altKey && key === "m") {
    event.preventDefault();
    options.insertTableOfContents();
  } else if (primary && event.altKey && key === "o") {
    event.preventDefault();
    options.toggleOutlinePanel();
  } else if (primary && event.shiftKey && key === "v") {
    event.preventDefault();
    options.togglePreview();
  } else if (primary && event.altKey && isMarkdownHeadingKey(key)) {
    event.preventDefault();
    options.applySourceHeading(Number(key) as MarkdownHeadingLevel);
  } else if (
    autoPairSource(event, options.content, "code", options.applySourceEdit)
  ) {
    event.preventDefault();
    requestAnimationFrame(options.updateCursor);
  }
}

interface MarkdownSourcePasteInterception {
  pastedText: string;
  selectionStart: number;
  selectionEnd: number;
}

interface MarkdownSourcePasteOptions {
  content: string;
  handleSharedSourcePaste: (
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    intercept: (paste: MarkdownSourcePasteInterception) => boolean,
  ) => void;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  updateContent: (content: string) => void;
}

export function handleMarkdownSourcePaste(
  event: ReactClipboardEvent<HTMLTextAreaElement>,
  options: MarkdownSourcePasteOptions,
) {
  options.handleSharedSourcePaste(
    event,
    ({ pastedText, selectionStart, selectionEnd }) => {
      const pasted = pastedText.trim();
      if (selectionStart === selectionEnd || !isMarkdownUrl(pasted)) {
        return false;
      }
      event.preventDefault();
      const selected = options.content.slice(selectionStart, selectionEnd);
      const next = `${options.content.slice(0, selectionStart)}[${selected}](${pasted})${options.content.slice(selectionEnd)}`;
      options.updateContent(next);
      requestAnimationFrame(() => {
        const textarea = options.sourceRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          selectionStart,
          selectionStart + selected.length + pasted.length + 4,
        );
      });
      return true;
    },
  );
}
