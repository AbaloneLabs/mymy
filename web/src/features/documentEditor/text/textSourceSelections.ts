import { offsetForTextLine } from "./textSourceNavigation";
import type {
  SourceMultiCursorEdit,
  SourceSelectionLineFragment,
  SourceSelectionRange,
} from "./textSourceTypes";

export function normalizeSourceSelectionRanges(
  ranges: SourceSelectionRange[],
): SourceSelectionRange[] {
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, range.end)),
      end: Math.max(0, Math.max(range.start, range.end)),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const output: SourceSelectionRange[] = [];
  normalized.forEach((range) => {
    const previous = output.at(-1);
    if (!previous) {
      output.push(range);
      return;
    }
    if (range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return;
    }
    if (range.start === previous.start && range.end === previous.end) return;
    output.push(range);
  });
  return output;
}

export function sourceNextOccurrenceRanges(
  content: string,
  ranges: SourceSelectionRange[],
  selectionStart: number,
  selectionEnd: number,
): SourceSelectionRange[] {
  const currentRanges = normalizeSourceSelectionRanges(
    ranges.length > 0 ? ranges : [{ start: selectionStart, end: selectionEnd }],
  );
  const firstRange = currentRanges[0];
  const queryRange =
    firstRange && firstRange.start !== firstRange.end
      ? firstRange
      : sourceWordRangeAtOffset(content, selectionStart);
  if (!queryRange || queryRange.start === queryRange.end) return currentRanges;
  const query = content.slice(queryRange.start, queryRange.end);
  if (!query) return currentRanges;
  if (currentRanges.length === 1 && firstRange?.start === firstRange.end) {
    return [queryRange];
  }
  const after = currentRanges.at(-1)?.end ?? queryRange.end;
  const nextIndex = nextPlainTextOccurrence(content, query, after, currentRanges);
  if (nextIndex === null) return currentRanges;
  return normalizeSourceSelectionRanges([
    ...currentRanges,
    { start: nextIndex, end: nextIndex + query.length },
  ]);
}

export function rectangularSourceSelectionRanges(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): SourceSelectionRange[] {
  if (selectionStart === selectionEnd) return [];
  const start = textOffsetPosition(content, selectionStart);
  const end = textOffsetPosition(content, selectionEnd);
  const topLine = Math.min(start.line, end.line);
  const bottomLine = Math.max(start.line, end.line);
  const leftColumn = Math.min(start.column, end.column);
  const rightColumn = Math.max(start.column, end.column);
  if (topLine === bottomLine) {
    return normalizeSourceSelectionRanges([{ start: selectionStart, end: selectionEnd }]);
  }
  const lineOffsets = textLineOffsets(content);
  return normalizeSourceSelectionRanges(
    Array.from({ length: bottomLine - topLine + 1 }, (_, offset) => {
      const line = topLine + offset;
      const lineStart = lineOffsets[line - 1] ?? content.length;
      const lineEnd = lineOffsets[line] !== undefined
        ? Math.max(lineStart, (lineOffsets[line] ?? lineStart) - 1)
        : content.length;
      const lineLength = Math.max(0, lineEnd - lineStart);
      const startColumn = Math.min(leftColumn, lineLength);
      const endColumn = Math.min(rightColumn, lineLength);
      return {
        start: lineStart + startColumn,
        end: lineStart + endColumn,
      };
    }),
  );
}

export function applySourceSelectionTextEdit(
  content: string,
  ranges: SourceSelectionRange[],
  text: string,
): SourceMultiCursorEdit | null {
  const normalized = normalizeSourceSelectionRanges(ranges);
  if (normalized.length === 0) return null;
  let nextContent = "";
  let cursor = 0;
  const nextRanges: SourceSelectionRange[] = [];
  normalized.forEach((range) => {
    nextContent += content.slice(cursor, range.start);
    const nextStart = nextContent.length;
    nextContent += text;
    nextRanges.push({ start: nextStart, end: nextStart + text.length });
    cursor = range.end;
  });
  nextContent += content.slice(cursor);
  return {
    content: nextContent,
    ranges: nextRanges,
    primaryRange: nextRanges.at(-1) ?? { start: nextContent.length, end: nextContent.length },
  };
}

export function applySourceSelectionDelete(
  content: string,
  ranges: SourceSelectionRange[],
  direction: "backward" | "forward",
): SourceMultiCursorEdit | null {
  const normalized = normalizeSourceSelectionRanges(ranges);
  if (normalized.length === 0) return null;
  const deleteRanges = normalizeSourceSelectionRanges(
    normalized.map((range) => {
      if (range.start !== range.end) return range;
      if (direction === "backward") {
        return { start: Math.max(0, range.start - 1), end: range.start };
      }
      return { start: range.start, end: Math.min(content.length, range.end + 1) };
    }),
  ).filter((range) => range.start !== range.end);
  if (deleteRanges.length === 0) return null;
  let nextContent = "";
  let cursor = 0;
  const nextRanges: SourceSelectionRange[] = [];
  deleteRanges.forEach((range) => {
    nextContent += content.slice(cursor, range.start);
    nextRanges.push({ start: nextContent.length, end: nextContent.length });
    cursor = range.end;
  });
  nextContent += content.slice(cursor);
  return {
    content: nextContent,
    ranges: nextRanges,
    primaryRange: nextRanges.at(-1) ?? { start: nextContent.length, end: nextContent.length },
  };
}

export function sourceSelectionLineFragments(
  content: string,
  ranges: SourceSelectionRange[],
): SourceSelectionLineFragment[] {
  const normalized = normalizeSourceSelectionRanges(ranges);
  const fragments: SourceSelectionLineFragment[] = [];
  normalized.forEach((range) => {
    const start = textOffsetPosition(content, range.start);
    const end = textOffsetPosition(content, range.end);
    for (let line = start.line; line <= end.line; line += 1) {
      const lineStartColumn = line === start.line ? start.column : 0;
      const lineEndColumn = line === end.line ? end.column : textLineLength(content, line);
      fragments.push({
        line,
        startColumn: Math.min(lineStartColumn, lineEndColumn),
        endColumn: Math.max(lineStartColumn, lineEndColumn),
        caret: range.start === range.end,
      });
    }
  });
  return fragments;
}

function sourceWordRangeAtOffset(content: string, offset: number): SourceSelectionRange | null {
  if (!content) return null;
  const startOffset = Math.max(0, Math.min(offset, content.length - 1));
  const fallbackOffset =
    isSourceWordChar(content[startOffset]) ? startOffset : Math.max(0, startOffset - 1);
  if (!isSourceWordChar(content[fallbackOffset])) return null;
  let start = fallbackOffset;
  let end = fallbackOffset + 1;
  while (start > 0 && isSourceWordChar(content[start - 1])) start -= 1;
  while (end < content.length && isSourceWordChar(content[end])) end += 1;
  return { start, end };
}

function nextPlainTextOccurrence(
  content: string,
  query: string,
  start: number,
  existingRanges: SourceSelectionRange[],
) {
  const occupied = new Set(existingRanges.map((range) => `${range.start}:${range.end}`));
  const searchStarts = [Math.max(0, start), 0];
  for (const searchStart of searchStarts) {
    let index = content.indexOf(query, searchStart);
    while (index >= 0) {
      const key = `${index}:${index + query.length}`;
      if (!occupied.has(key)) return index;
      index = content.indexOf(query, index + Math.max(1, query.length));
    }
  }
  return null;
}

function isSourceWordChar(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_$-]/.test(char));
}

function textLineOffsets(content: string) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function textOffsetPosition(content: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: clamped - lineStart };
}

function textLineLength(content: string, line: number) {
  const lineStart = offsetForTextLine(content, line);
  const nextLineStart = offsetForTextLine(content, line + 1);
  const lineEnd =
    nextLineStart > lineStart && content[nextLineStart - 1] === "\n"
      ? nextLineStart - 1
      : nextLineStart;
  return Math.max(0, lineEnd - lineStart);
}
