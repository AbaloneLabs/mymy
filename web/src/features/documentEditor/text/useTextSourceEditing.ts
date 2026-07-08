import { useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import {
  applySourceSelectionDelete,
  applySourceSelectionTextEdit,
  rectangularSourceSelectionRanges,
  sourceNextOccurrenceRanges,
  startChunkedSourcePaste,
} from "./textSourceUtils";
import type {
  SourceEdit,
  SourceMultiCursorEdit,
  SourceSelectionRange,
} from "./textSourceUtils";

const DEFAULT_LARGE_SOURCE_PASTE_CHAR_LIMIT = 100_000;

interface TextSourceEditingOptions {
  content: string;
  folded: boolean;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  updateContent: (
    content: string,
    options?: { preserveSourceSelections?: boolean },
  ) => void;
  unfoldAll: () => void;
  updateCursor: () => void;
  syncLineNumberScroll: () => void;
  largePasteCharLimit?: number;
}

interface SourcePasteInterception {
  pastedText: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * This hook keeps source-editor textarea behavior in one place so that plain
 * text, code, JSON/YAML/TOML, and Markdown can share cursor, multi-selection,
 * and large paste semantics without each editor reimplementing the same focus
 * and selection bookkeeping.
 */
export function useTextSourceEditing({
  content,
  folded,
  sourceRef,
  updateContent,
  unfoldAll,
  updateCursor,
  syncLineNumberScroll,
  largePasteCharLimit = DEFAULT_LARGE_SOURCE_PASTE_CHAR_LIMIT,
}: TextSourceEditingOptions) {
  const pasteCancelRef = useRef<(() => void) | null>(null);
  const [sourceSelectionRanges, setSourceSelectionRanges] = useState<
    SourceSelectionRange[]
  >([]);
  const [pasteProgress, setPasteProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    return () => pasteCancelRef.current?.();
  }, []);

  function clearSourceSelections() {
    setSourceSelectionRanges([]);
  }

  function applySourceEdit(
    edit: SourceEdit | null,
    fallbackSelection?: { start: number; end: number },
  ) {
    if (!edit) return;
    updateContent(edit.content);
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(
        fallbackSelection?.start ?? edit.selectionStart,
        fallbackSelection?.end ?? edit.selectionEnd,
      );
      updateCursor();
      syncLineNumberScroll();
    });
  }

  function applySourceMultiCursorEdit(edit: SourceMultiCursorEdit | null) {
    if (!edit) return;
    updateContent(edit.content, { preserveSourceSelections: true });
    setSourceSelectionRanges(edit.ranges);
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(edit.primaryRange.start, edit.primaryRange.end);
      updateCursor();
      syncLineNumberScroll();
    });
  }

  function addNextSourceSelection() {
    if (folded) return;
    const textarea = sourceRef.current;
    if (!textarea) return;
    const nextRanges = sourceNextOccurrenceRanges(
      content,
      sourceSelectionRanges,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    setSourceSelectionRanges(nextRanges);
    const primaryRange = nextRanges.at(-1);
    if (!primaryRange) return;
    textarea.setSelectionRange(primaryRange.start, primaryRange.end);
    updateCursor();
  }

  function activateRectangularSourceSelection() {
    if (folded) return;
    const textarea = sourceRef.current;
    if (!textarea) return;
    const ranges = rectangularSourceSelectionRanges(
      content,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (ranges.length === 0) return;
    setSourceSelectionRanges(ranges);
    const primaryRange = ranges.at(-1);
    if (!primaryRange) return;
    textarea.setSelectionRange(primaryRange.start, primaryRange.end);
    updateCursor();
  }

  function handleSourceMultiCursorKey(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (sourceSelectionRanges.length === 0) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setSourceSelectionRanges([]);
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) {
      return false;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      applySourceMultiCursorEdit(
        applySourceSelectionDelete(
          content,
          sourceSelectionRanges,
          event.key === "Backspace" ? "backward" : "forward",
        ),
      );
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab" || event.key.length === 1) {
      event.preventDefault();
      applySourceMultiCursorEdit(
        applySourceSelectionTextEdit(
          content,
          sourceSelectionRanges,
          event.key === "Enter" ? "\n" : event.key === "Tab" ? "  " : event.key,
        ),
      );
      return true;
    }
    return false;
  }

  function withTextareaSelection(
    operation: (start: number, end: number) => SourceEdit | null,
  ) {
    if (folded) return;
    const textarea = sourceRef.current;
    if (!textarea) return;
    applySourceEdit(operation(textarea.selectionStart, textarea.selectionEnd));
  }

  function handleSourcePaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    intercept?: (paste: SourcePasteInterception) => boolean,
  ) {
    if (folded) {
      event.preventDefault();
      unfoldAll();
      return;
    }
    const textarea = sourceRef.current;
    if (!textarea) return;
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) return;
    if (sourceSelectionRanges.length > 0) {
      event.preventDefault();
      applySourceMultiCursorEdit(
        applySourceSelectionTextEdit(
          content,
          sourceSelectionRanges,
          pastedText,
        ),
      );
      return;
    }
    if (
      intercept?.({
        pastedText,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      })
    ) {
      return;
    }
    if (pastedText.length < largePasteCharLimit) return;
    event.preventDefault();
    pasteCancelRef.current?.();
    setSourceSelectionRanges([]);
    pasteCancelRef.current = startChunkedSourcePaste({
      content,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      pastedText,
      onChunk: (edit, progress) => {
        updateContent(edit.content, { preserveSourceSelections: true });
        setPasteProgress(progress);
      },
      onDone: (edit) => {
        pasteCancelRef.current = null;
        setPasteProgress(null);
        requestAnimationFrame(() => {
          const source = sourceRef.current;
          if (!source) return;
          source.focus();
          source.setSelectionRange(edit.selectionStart, edit.selectionEnd);
          updateCursor();
          syncLineNumberScroll();
        });
      },
    });
  }

  return {
    activateRectangularSourceSelection,
    addNextSourceSelection,
    applySourceEdit,
    applySourceMultiCursorEdit,
    clearSourceSelections,
    handleSourceMultiCursorKey,
    handleSourcePaste,
    pasteProgress,
    setSourceSelectionRanges,
    sourceSelectionRanges,
    withTextareaSelection,
  };
}
