import type { RefObject } from "react";
import {
  buildMarkdownSearchRegex,
  nextMarkdownSearchRange,
} from "./markdownEditorUtils";

type MarkdownSearchActionParams = {
  content: string;
  focusSourceRange: (start: number, end: number) => void;
  matchCase: boolean;
  regexSearch: boolean;
  replaceDraft: string;
  searchDraft: string;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  updateContent: (content: string) => void;
  wholeWord: boolean;
};

export function useMarkdownSearchActions({
  content,
  focusSourceRange,
  matchCase,
  regexSearch,
  replaceDraft,
  searchDraft,
  sourceRef,
  updateContent,
  wholeWord,
}: MarkdownSearchActionParams) {
  function findNext() {
    const start = sourceRef.current?.selectionEnd ?? 0;
    const range = nextMarkdownSearchRange(content, searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
      start,
    });
    if (range) focusSourceRange(range.start, range.end);
  }

  function replaceNext() {
    const textarea = sourceRef.current;
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const selected = content.slice(textarea.selectionStart, textarea.selectionEnd);
      regex.lastIndex = 0;
      const match = regex.exec(selected);
      if (match && match.index === 0 && match[0].length === selected.length) {
        const next = `${content.slice(0, textarea.selectionStart)}${selected.replace(regex, replaceDraft)}${content.slice(textarea.selectionEnd)}`;
        const caret = textarea.selectionStart + replaceDraft.length;
        updateContent(next);
        requestAnimationFrame(() => focusSourceRange(caret, caret));
        return;
      }
    }
    findNext();
  }

  function replaceAll() {
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    updateContent(content.replace(regex, replaceDraft));
  }

  return {
    findNext,
    replaceAll,
    replaceNext,
  };
}
