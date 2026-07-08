export interface TextLineRange {
  startLineIndex: number;
  endLineIndex: number;
}

/**
 * The source editor stores files as plain strings for persistence, but virtual
 * editing needs deterministic line replacement without constructing DOM nodes
 * for the whole file. These helpers form the small buffer boundary shared by
 * the large-file viewport and future language-service adapters.
 */
export function replaceTextLineRange(
  content: string,
  range: TextLineRange,
  replacement: string,
) {
  const lineRanges = textLineOffsetRanges(content);
  const start = lineRanges[range.startLineIndex]?.start ?? content.length;
  const end =
    lineRanges[Math.max(range.startLineIndex, range.endLineIndex - 1)]?.end ??
    content.length;
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

export function textLineOffsetRanges(content: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  if (content.length === 0) return [{ start: 0, end: 0 }];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") continue;
    ranges.push({ start, end: index + 1 });
    start = index + 1;
  }
  if (start < content.length) {
    ranges.push({ start, end: content.length });
  }
  return ranges;
}
