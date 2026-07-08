import { useEffect, useRef, useState } from "react";
import {
  buildSearchRegex,
  countSearchMatches,
  nextSearchRange,
  startChunkedSearchCount,
  startChunkedSearchRange,
} from "./textSourceUtils";
import type { SourceSelectionRange } from "./textSourceUtils";

type LargeSearchSignature = {
  caseSensitive: boolean;
  content: string;
  query: string;
  regexSearch: boolean;
  wholeWord: boolean;
};

type TextEditorSearchOptions = {
  caseSensitive: boolean;
  content: string;
  focusSourceRange: (start: number, end: number) => void;
  largeTextMode: boolean;
  regexSearch: boolean;
  replaceDraft: string;
  searchDraft: string;
  sourceRef: {
    current: HTMLTextAreaElement | null;
  };
  updateContent: (content: string) => void;
  wholeWord: boolean;
};

export function useTextEditorSearch({
  caseSensitive,
  content,
  focusSourceRange,
  largeTextMode,
  regexSearch,
  replaceDraft,
  searchDraft,
  sourceRef,
  updateContent,
  wholeWord,
}: TextEditorSearchOptions) {
  const searchCountCancelRef = useRef<(() => void) | null>(null);
  const searchRangeCancelRef = useRef<(() => void) | null>(null);
  const [streamingSearchCount, setStreamingSearchCount] = useState<{
    query: string;
    count: number;
    processed: number;
    total: number;
    complete: boolean;
  } | null>(null);
  const [largeSearchResult, setLargeSearchResult] = useState<{
    range: SourceSelectionRange | null;
    signature: LargeSearchSignature;
  } | null>(null);
  const [largeSearchNavigation, setLargeSearchNavigation] = useState<{
    processed: number;
    total: number;
    signature: LargeSearchSignature;
  } | null>(null);
  const largeSearchSignature = {
    caseSensitive,
    content,
    query: searchDraft,
    regexSearch,
    wholeWord,
  };
  const streamingSearchCountForQuery =
    streamingSearchCount?.query === searchDraft ? streamingSearchCount : null;
  const largeSearchRange =
    largeSearchResult &&
    sameLargeSearchSignature(largeSearchResult.signature, largeSearchSignature)
      ? largeSearchResult.range
      : null;
  const largeSearchNavigationForQuery =
    largeSearchNavigation &&
    sameLargeSearchSignature(largeSearchNavigation.signature, largeSearchSignature)
      ? largeSearchNavigation
      : null;
  const searchMatches = largeTextMode
    ? (streamingSearchCountForQuery?.count ?? 0)
    : countSearchMatches(content, searchDraft, {
        caseSensitive,
        wholeWord,
        regexSearch,
      });

  useEffect(() => {
    return () => {
      searchCountCancelRef.current?.();
      searchRangeCancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    searchRangeCancelRef.current?.();
    searchRangeCancelRef.current = null;
  }, [
    caseSensitive,
    content,
    largeTextMode,
    regexSearch,
    searchDraft,
    wholeWord,
  ]);

  useEffect(() => {
    searchCountCancelRef.current?.();
    searchCountCancelRef.current = null;
    if (!largeTextMode || !searchDraft) return;
    searchCountCancelRef.current = startChunkedSearchCount({
      content,
      query: searchDraft,
      caseSensitive,
      wholeWord,
      regexSearch,
      onProgress: ({ count, processed, total }) =>
        setStreamingSearchCount({
          query: searchDraft,
          count,
          processed,
          total,
          complete: false,
        }),
      onDone: (count) =>
        setStreamingSearchCount({
          query: searchDraft,
          count,
          processed: content.length,
          total: content.length,
          complete: true,
        }),
    });
    return () => {
      searchCountCancelRef.current?.();
      searchCountCancelRef.current = null;
    };
  }, [
    caseSensitive,
    content,
    largeTextMode,
    regexSearch,
    searchDraft,
    wholeWord,
  ]);

  function findNext() {
    if (largeTextMode) {
      searchRangeCancelRef.current?.();
      searchRangeCancelRef.current = null;
      if (!searchDraft) return;
      setLargeSearchNavigation({
        processed: 0,
        total: content.length,
        signature: largeSearchSignature,
      });
      searchRangeCancelRef.current = startChunkedSearchRange({
        content,
        query: searchDraft,
        caseSensitive,
        wholeWord,
        regexSearch,
        start: largeSearchRange?.end ?? 0,
        onProgress: (progress) =>
          setLargeSearchNavigation({
            ...progress,
            signature: largeSearchSignature,
          }),
        onDone: (range) => {
          searchRangeCancelRef.current = null;
          setLargeSearchNavigation(null);
          setLargeSearchResult({ range, signature: largeSearchSignature });
        },
      });
      return;
    }
    const start = sourceRef.current?.selectionEnd ?? 0;
    const range = nextSearchRange(content, searchDraft, {
      caseSensitive,
      wholeWord,
      regexSearch,
      start,
    });
    if (range) focusSourceRange(range.start, range.end);
  }

  function replaceNext() {
    const textarea = sourceRef.current;
    const regex = buildSearchRegex(searchDraft, {
      caseSensitive,
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
    const regex = buildSearchRegex(searchDraft, {
      caseSensitive,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    updateContent(content.replace(regex, replaceDraft));
  }

  return {
    findNext,
    largeSearchNavigationForQuery,
    largeSearchRange,
    replaceAll,
    replaceNext,
    searchMatches,
    streamingSearchCountForQuery,
  };
}

function sameLargeSearchSignature(
  left: LargeSearchSignature,
  right: LargeSearchSignature,
) {
  return (
    left.content === right.content &&
    left.query === right.query &&
    left.caseSensitive === right.caseSensitive &&
    left.wholeWord === right.wholeWord &&
    left.regexSearch === right.regexSearch
  );
}
