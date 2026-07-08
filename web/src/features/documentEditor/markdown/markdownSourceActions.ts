import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  lineForOffset,
  offsetForLine,
} from "./markdownEditorUtils";
import type { MarkdownHeadingLevel } from "./markdownEditorUtils";
import type { SourceFoldRange } from "../text";

type MarkdownSourceActionParams = {
  content: string;
  foldRanges: SourceFoldRange[];
  goToLineDraft: string;
  lineCount: number;
  setFoldedSourceIds: Dispatch<SetStateAction<Set<string>>>;
  setGoToLineOpen: Dispatch<SetStateAction<boolean>>;
  setMode: Dispatch<SetStateAction<"source" | "preview">>;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  syncLineNumberScroll: () => void;
  updateContent: (content: string) => void;
  updateCursor: () => void;
};

export function useMarkdownSourceActions({
  content,
  foldRanges,
  goToLineDraft,
  lineCount,
  setFoldedSourceIds,
  setGoToLineOpen,
  setMode,
  sourceRef,
  syncLineNumberScroll,
  updateContent,
  updateCursor,
}: MarkdownSourceActionParams) {
  function insertSourceSnippet(
    snippet: string,
    selectStartOffset = snippet.length,
    selectEndOffset = selectStartOffset,
  ) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      updateContent(`${content}${prefix}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !snippet.endsWith("\n") ? "\n" : "";
    const inserted = `${prefix}${snippet}${suffix}`;
    const next = `${before}${inserted}${after}`;
    updateContent(next);
    const selectionStart = start + prefix.length + selectStartOffset;
    const selectionEnd = start + prefix.length + selectEndOffset;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      syncLineNumberScroll();
    });
  }

  function insertSourceInline(text: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      updateContent(`${content}${prefix}${text}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${content.slice(0, start)}${text}${content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
      syncLineNumberScroll();
    });
  }

  function insertSourceLink(url: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      updateContent(`${content}${prefix}[${url}](${url})`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end);
    const label = selected || url;
    const link = `[${label}](${url})`;
    const next = `${content.slice(0, start)}${link}${content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1 + label.length);
      syncLineNumberScroll();
    });
  }

  function wrapSourceSelection(before: string, after = before) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${content.slice(0, start)}${before}${content.slice(start, end)}${after}${content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function applyHeading(level: MarkdownHeadingLevel) {
    applySourceHeading(level);
  }

  function applySourceHeading(level: MarkdownHeadingLevel) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = content.indexOf("\n", start);
    const end = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(lineStart, end);
    const prefix = `${"#".repeat(level)} `;
    const nextLine = line.replace(/^#{1,6}\s+/, "");
    const next = `${content.slice(0, lineStart)}${prefix}${nextLine}${content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length + nextLine.length);
      updateCursor();
    });
  }

  function transformSelectedSourceLines(transform: (line: string) => string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextNewline = content.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const block = content.slice(lineStart, lineEnd);
    const nextBlock = block.split("\n").map(transform).join("\n");
    const next = `${content.slice(0, lineStart)}${nextBlock}${content.slice(lineEnd)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + nextBlock.length);
      updateCursor();
    });
  }

  function focusSourceLine(line: number) {
    unfoldSourceLine(line);
    focusSourceRange(offsetForLine(content, line), offsetForLine(content, line));
  }

  function toggleSourceFold(range: SourceFoldRange) {
    setFoldedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(range.id)) next.delete(range.id);
      else next.add(range.id);
      return next;
    });
  }

  function unfoldSourceLine(line: number) {
    setFoldedSourceIds((current) => {
      const hiddenRange = foldRanges.find(
        (range) => current.has(range.id) && line > range.startLine && line <= range.endLine,
      );
      if (!hiddenRange) return current;
      const next = new Set(current);
      next.delete(hiddenRange.id);
      return next;
    });
  }

  function focusSourceRange(start: number, end: number) {
    setMode("source");
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const line = lineForOffset(content, start);
      textarea.scrollTop = Math.max(0, (line - 4) * 24);
      syncLineNumberScroll();
      updateCursor();
    });
  }

  function submitGoToLine() {
    const line = Math.max(1, Math.min(lineCount, Math.floor(Number(goToLineDraft))));
    if (!Number.isFinite(line)) return;
    focusSourceLine(line);
    setGoToLineOpen(false);
  }

  return {
    applyHeading,
    applySourceHeading,
    focusSourceLine,
    focusSourceRange,
    insertSourceInline,
    insertSourceLink,
    insertSourceSnippet,
    submitGoToLine,
    toggleSourceFold,
    transformSelectedSourceLines,
    wrapSourceSelection,
  };
}
