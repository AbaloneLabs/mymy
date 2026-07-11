import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { SourceSelectionRange } from "./textSourceTypes";
import {
  PieceTableTextBuffer,
  textLineStartOffsets,
  textLineWindow,
  textLineWindowRange,
} from "./textBuffer";
import { LARGE_TEXT_EDIT_WINDOW_CHAR_LIMIT } from "./textLargeFilePolicy";

const LARGE_TEXT_LINE_HEIGHT = 24;
const LARGE_TEXT_OVERSCAN_LINES = 24;

interface LargeTextEditWindow {
  baseContent: string;
  startLineIndex: number;
  endLineIndex: number;
  startOffset: number;
  endOffset: number;
  original: string;
  draft: string;
  scrollTop: number;
}

export function LargeTextSourceViewer({
  content,
  lineCount,
  readOnly,
  searchRange,
  targetLineRequest,
  onChangeContent,
}: {
  content: string;
  lineCount: number;
  readOnly: boolean;
  searchRange?: SourceSelectionRange | null;
  targetLineRequest?: { line: number; token: number } | null;
  onChangeContent?: (content: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const [editWindow, setEditWindow] = useState<LargeTextEditWindow | null>(null);
  const [composing, setComposing] = useState(false);
  const lineStarts = useMemo(() => textLineStartOffsets(content), [content]);
  const visibleLineCount = Math.ceil(viewport.height / LARGE_TEXT_LINE_HEIGHT);
  const calculatedStart = Math.max(
    0,
    Math.floor(viewport.scrollTop / LARGE_TEXT_LINE_HEIGHT) -
      LARGE_TEXT_OVERSCAN_LINES,
  );
  const calculatedEnd = Math.min(
    lineStarts.length,
    calculatedStart + visibleLineCount + LARGE_TEXT_OVERSCAN_LINES * 2,
  );
  const start = editWindow?.startLineIndex ?? calculatedStart;
  const end = editWindow?.endLineIndex ?? calculatedEnd;
  const top = start * LARGE_TEXT_LINE_HEIGHT;
  const visibleLines = useMemo(
    () => textLineWindow(content, lineStarts, start, end),
    [content, end, lineStarts, start],
  );
  const visibleRange = textLineWindowRange(
    content.length,
    lineStarts,
    calculatedStart,
    calculatedEnd,
  );
  const visibleWindowLength = visibleRange.end - visibleRange.start;
  const editWindowTooLarge =
    visibleWindowLength > LARGE_TEXT_EDIT_WINDOW_CHAR_LIMIT;
  const staleEdit = Boolean(editWindow && editWindow.baseContent !== content);
  const editDirty = Boolean(editWindow && editWindow.draft !== editWindow.original);
  const scrollToLine = useEffectEvent((lineIndex: number) => {
    const element = viewportRef.current;
    if (!element) return;
    const nextScrollTop = Math.max(
      0,
      (lineIndex - LARGE_TEXT_OVERSCAN_LINES) * LARGE_TEXT_LINE_HEIGHT,
    );
    element.scrollTop = nextScrollTop;
    setViewport({ height: element.clientHeight, scrollTop: nextScrollTop });
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport({ height: element.clientHeight, scrollTop: element.scrollTop });
  }, []);

  useEffect(() => {
    if (!searchRange || editWindow) return;
    scrollToLine(lineIndexForOffset(lineStarts, searchRange.start));
  }, [editWindow, lineStarts, searchRange]);

  useEffect(() => {
    if (!targetLineRequest || editWindow) return;
    scrollToLine(Math.max(0, targetLineRequest.line - 1));
  }, [editWindow, targetLineRequest]);

  function beginWindowEdit() {
    if (readOnly || !onChangeContent || editWindowTooLarge) return;
    const original = content.slice(visibleRange.start, visibleRange.end);
    setEditWindow({
      baseContent: content,
      startLineIndex: calculatedStart,
      endLineIndex: calculatedEnd,
      startOffset: visibleRange.start,
      endOffset: visibleRange.end,
      original,
      draft: original,
      scrollTop: viewport.scrollTop,
    });
  }

  function applyWindowEdit() {
    if (!editWindow || composing || staleEdit || !onChangeContent) return;
    if (!editDirty) {
      setEditWindow(null);
      return;
    }
    const buffer = new PieceTableTextBuffer(content);
    buffer.replace(editWindow.startOffset, editWindow.endOffset, editWindow.draft);
    onChangeContent(buffer.toString());
    setEditWindow(null);
  }

  function cancelWindowEdit() {
    setComposing(false);
    setEditWindow(null);
  }

  const draftLineCount = editWindow ? countLines(editWindow.draft) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
        <span className="text-[var(--text-muted)]">
          {readOnly
            ? "Read-only at this size · search and navigation remain available"
            : editWindow
              ? `Editing lines ${editWindow.startLineIndex + 1}-${Math.max(editWindow.startLineIndex + 1, editWindow.endLineIndex)}`
              : `Visible lines ${calculatedStart + 1}-${Math.max(calculatedStart + 1, calculatedEnd)}`}
        </span>
        {editWindow ? (
          <div className="flex items-center gap-2">
            {staleEdit && (
              <span className="text-[var(--status-danger)]">
                Source changed; cancel and reopen this window.
              </span>
            )}
            <button
              type="button"
              onClick={cancelWindowEdit}
              className="rounded border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={composing || staleEdit || !editDirty}
              onClick={applyWindowEdit}
              className="rounded border border-[var(--accent)] px-2 py-1 text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply window edit
            </button>
          </div>
        ) : !readOnly ? (
          <button
            type="button"
            disabled={editWindowTooLarge}
            onClick={beginWindowEdit}
            title={
              editWindowTooLarge
                ? "The visible window exceeds the bounded edit limit. Scroll to a shorter-line region."
                : "Create one reversible edit transaction for the visible source window"
            }
            className="rounded border border-[var(--border)] px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editWindowTooLarge ? "Visible window too large to edit" : "Edit visible window"}
          </button>
        ) : null}
      </div>
      <div
        ref={viewportRef}
        onScroll={(event) => {
          if (editWindow) {
            event.currentTarget.scrollTop = editWindow.scrollTop;
            return;
          }
          setViewport({
            height: event.currentTarget.clientHeight,
            scrollTop: event.currentTarget.scrollTop,
          });
        }}
        className="min-h-0 flex-1 overflow-auto font-mono text-sm text-[var(--text)]"
      >
        <div
          className="relative min-w-max"
          style={{ height: Math.max(1, lineCount) * LARGE_TEXT_LINE_HEIGHT }}
        >
          <div
            className="absolute left-0 right-0 grid grid-cols-[auto_minmax(0,1fr)]"
            style={{ transform: `translateY(${top}px)` }}
          >
            {visibleLines.map((line) => {
              const lineNumber = line.lineIndex + 1;
              return (
                <div key={lineNumber} className="contents">
                  <div
                    className="select-none border-r border-[var(--border)] bg-[var(--surface)] px-3 text-right text-xs leading-6 text-[var(--text-faint)]"
                    style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                  >
                    {lineNumber}
                  </div>
                  <pre
                    className="m-0 whitespace-pre px-4 text-sm leading-6"
                    style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                  >
                    <LargeTextLineContent
                      line={line.text}
                      lineStart={line.start}
                      lineEnd={line.start + line.text.length}
                      searchRange={searchRange}
                    />
                  </pre>
                </div>
              );
            })}
            {editWindow && (
              <textarea
                value={editWindow.draft}
                onChange={(event) => {
                  const draft = event.currentTarget.value;
                  setEditWindow((current) =>
                    current ? { ...current, draft } : current,
                  );
                }}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelWindowEdit();
                  } else if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    applyWindowEdit();
                  }
                }}
                spellCheck={false}
                autoFocus
                className="absolute left-16 right-0 top-0 resize-none bg-[var(--bg)] px-4 font-mono text-sm leading-6 text-[var(--text)] outline-none ring-1 ring-inset ring-[var(--accent)]"
                style={{
                  height:
                    Math.max(1, end - start, draftLineCount) *
                    LARGE_TEXT_LINE_HEIGHT,
                  tabSize: 2,
                }}
                aria-label="Large file transactional edit window"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LargeTextLineContent({
  line,
  lineStart,
  lineEnd,
  searchRange,
}: {
  line: string;
  lineStart: number;
  lineEnd: number;
  searchRange?: SourceSelectionRange | null;
}) {
  if (!searchRange || searchRange.end <= lineStart || searchRange.start > lineEnd) {
    return line || " ";
  }
  const startColumn = Math.max(0, searchRange.start - lineStart);
  const endColumn = Math.max(
    startColumn,
    Math.min(line.length, searchRange.end - lineStart),
  );
  if (startColumn === endColumn) return line || " ";
  return (
    <>
      {line.slice(0, startColumn)}
      <mark className="rounded-sm bg-[var(--accent)]/30 px-0 text-[var(--text)]">
        {line.slice(startColumn, endColumn)}
      </mark>
      {line.slice(endColumn) || " "}
    </>
  );
}

function lineIndexForOffset(lineStarts: number[], offset: number) {
  let low = 0;
  let high = Math.max(0, lineStarts.length - 1);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineStarts[mid] ?? 0;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < current) high = mid - 1;
    else if (offset >= next) low = mid + 1;
    else return mid;
  }
  return Math.max(0, Math.min(lineStarts.length - 1, low));
}

function countLines(value: string) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}
