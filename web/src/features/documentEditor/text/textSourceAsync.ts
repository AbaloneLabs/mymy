import type {
  ChunkedSearchCountOptions,
  ChunkedSearchRangeOptions,
  ChunkedSourcePasteOptions,
} from "./textSourceTypes";
import { buildSearchRegex } from "./textSourceNavigation";
import { advanceZeroWidthRegex } from "./textSearchSemantics";

export function startChunkedSourcePaste({
  content,
  selectionStart,
  selectionEnd,
  pastedText,
  chunkSize = 64 * 1024,
  onChunk,
  onDone,
}: ChunkedSourcePasteOptions) {
  let cancelled = false;
  let processed = 0;
  let inserted = "";
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(0, Math.max(selectionStart, selectionEnd));
  const prefix = content.slice(0, start);
  const suffix = content.slice(end);

  function step() {
    if (cancelled) return;
    const next = pastedText.slice(processed, processed + chunkSize);
    processed += next.length;
    inserted += next;
    const edit = {
      content: `${prefix}${inserted}${suffix}`,
      selectionStart: start + inserted.length,
      selectionEnd: start + inserted.length,
    };
    const progress = { processed, total: pastedText.length };
    onChunk(edit, progress);
    if (processed < pastedText.length) {
      scheduleSourceTask(step);
      return;
    }
    onDone?.(edit);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

export function startChunkedSearchCount({
  content,
  query,
  caseSensitive,
  wholeWord,
  regexSearch,
  chunkSize = 256 * 1024,
  onProgress,
  onDone,
}: ChunkedSearchCountOptions) {
  const regex = buildSearchRegex(query, { caseSensitive, wholeWord, regexSearch });
  if (!regex) {
    onDone(0);
    return () => undefined;
  }
  const searchRegex = regex;
  let cancelled = false;
  let offset = 0;
  let count = 0;
  const overlap = Math.max(256, regexSearch ? 1024 : query.length + 8);

  function step() {
    if (cancelled) return;
    const chunkStart = Math.max(0, offset - overlap);
    const chunkEnd = Math.min(content.length, offset + chunkSize);
    const chunk = content.slice(chunkStart, chunkEnd);
    const minimumAbsoluteStart = offset;
    searchRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(chunk))) {
      const absoluteStart = chunkStart + match.index;
      if (absoluteStart >= minimumAbsoluteStart && absoluteStart < chunkEnd) {
        count += 1;
      }
      if (match[0].length === 0) advanceZeroWidthRegex(searchRegex, chunk);
    }
    offset = chunkEnd;
    onProgress?.({ processed: offset, total: content.length, count });
    if (offset < content.length) {
      scheduleSourceTask(step);
      return;
    }
    onDone(count);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

export function startChunkedSearchRange({
  content,
  query,
  caseSensitive,
  wholeWord,
  regexSearch,
  start,
  chunkSize = 256 * 1024,
  onProgress,
  onDone,
}: ChunkedSearchRangeOptions) {
  const regex = buildSearchRegex(query, { caseSensitive, wholeWord, regexSearch });
  if (!regex) {
    onDone(null);
    return () => undefined;
  }
  const searchRegex = regex;
  const overlap = Math.max(256, regexSearch ? 1024 : query.length + 8);
  const firstStart = Math.max(0, Math.min(content.length, start));
  let cancelled = false;
  let offset = firstStart;
  let wrapped = false;

  function step() {
    if (cancelled) return;
    const limit = wrapped ? firstStart : content.length;
    if (offset >= limit) {
      if (!wrapped && firstStart > 0) {
        wrapped = true;
        offset = 0;
        scheduleSourceTask(step);
        return;
      }
      onDone(null);
      return;
    }

    const acceptedEnd = Math.min(limit, offset + chunkSize);
    const chunkEnd = Math.min(content.length, acceptedEnd + overlap);
    const chunk = content.slice(offset, chunkEnd);
    searchRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(chunk))) {
      const absoluteStart = offset + match.index;
      if (absoluteStart >= offset && absoluteStart < acceptedEnd) {
        onDone({
          start: absoluteStart,
          end: absoluteStart + match[0].length,
        });
        return;
      }
      if (match[0].length === 0) advanceZeroWidthRegex(searchRegex, chunk);
    }

    offset = acceptedEnd;
    onProgress?.({
      processed: wrapped ? firstStart + offset : offset - firstStart,
      total: content.length,
    });
    scheduleSourceTask(step);
  }

  scheduleSourceTask(step);
  return () => {
    cancelled = true;
  };
}

function scheduleSourceTask(callback: () => void) {
  const browserWindow =
    typeof window === "undefined"
      ? null
      : (window as Window & {
          requestIdleCallback?: (
            callback: () => void,
            options?: { timeout: number },
          ) => number;
          requestAnimationFrame?: (callback: () => void) => number;
        });
  if (browserWindow?.requestIdleCallback) {
    const requestIdleCallback = browserWindow.requestIdleCallback as (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    requestIdleCallback(callback, { timeout: 80 });
    return;
  }
  if (browserWindow?.requestAnimationFrame) {
    browserWindow.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}
