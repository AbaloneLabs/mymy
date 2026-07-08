import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceSelectionRange } from "./textSourceTypes";

const LARGE_TEXT_LINE_HEIGHT = 24;
const LARGE_TEXT_OVERSCAN_LINES = 24;

export function LargeTextSourceViewer({
  content,
  lineCount,
  searchRange,
}: {
  content: string;
  lineCount: number;
  searchRange?: SourceSelectionRange | null;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const lines = useMemo(() => content.split("\n"), [content]);
  const lineOffsets = useMemo(() => largeTextLineOffsets(lines), [lines]);
  const visibleLineCount = Math.ceil(viewport.height / LARGE_TEXT_LINE_HEIGHT);
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / LARGE_TEXT_LINE_HEIGHT) - LARGE_TEXT_OVERSCAN_LINES,
  );
  const end = Math.min(
    lines.length,
    start + visibleLineCount + LARGE_TEXT_OVERSCAN_LINES * 2,
  );
  const top = start * LARGE_TEXT_LINE_HEIGHT;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport({ height: element.clientHeight, scrollTop: element.scrollTop });
  }, []);

  useEffect(() => {
    if (!searchRange) return;
    const element = viewportRef.current;
    if (!element) return;
    const lineIndex = lineIndexForOffset(lineOffsets, searchRange.start);
    const nextScrollTop = Math.max(
      0,
      (lineIndex - LARGE_TEXT_OVERSCAN_LINES) * LARGE_TEXT_LINE_HEIGHT,
    );
    element.scrollTop = nextScrollTop;
    setViewport({ height: element.clientHeight, scrollTop: nextScrollTop });
  }, [lineOffsets, searchRange]);

  return (
    <div
      ref={viewportRef}
      onScroll={(event) =>
        setViewport({
          height: event.currentTarget.clientHeight,
          scrollTop: event.currentTarget.scrollTop,
        })
      }
      className="h-full min-h-0 overflow-auto bg-[var(--bg)] font-mono text-sm text-[var(--text)]"
    >
      <div
        className="relative min-w-max"
        style={{ height: Math.max(1, lineCount) * LARGE_TEXT_LINE_HEIGHT }}
      >
        <div
          className="absolute left-0 right-0 grid grid-cols-[auto_minmax(0,1fr)]"
          style={{ transform: `translateY(${top}px)` }}
        >
          {lines.slice(start, end).map((line, offset) => {
            const lineNumber = start + offset + 1;
            const lineStart = lineOffsets[lineNumber - 1] ?? 0;
            const lineEnd = lineStart + line.length;
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
                    line={line}
                    lineStart={lineStart}
                    lineEnd={lineEnd}
                    searchRange={searchRange}
                  />
                </pre>
              </div>
            );
          })}
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
  const endColumn = Math.max(startColumn, Math.min(line.length, searchRange.end - lineStart));
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

function lineIndexForOffset(lineOffsets: number[], offset: number) {
  let low = 0;
  let high = Math.max(0, lineOffsets.length - 1);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineOffsets[mid] ?? 0;
    const next = lineOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < current) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(lineOffsets.length - 1, low));
}

function largeTextLineOffsets(lines: string[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}
