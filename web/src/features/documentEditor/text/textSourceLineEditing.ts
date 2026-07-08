import type { SourceEdit } from "./textSourceTypes";

export function selectedLineRange(content: string, start: number, end: number) {
  const lineStart = content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = content.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? content.length : nextNewline + 1;
  return { start: lineStart, end: lineEnd };
}

export function transformSelectedLines(
  content: string,
  start: number,
  end: number,
  transform: (line: string) => string,
): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const trailingNewline = block.endsWith("\n");
  const body = trailingNewline ? block.slice(0, -1) : block;
  const nextBody = body.split("\n").map(transform).join("\n");
  const nextBlock = trailingNewline ? `${nextBody}\n` : nextBody;
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.start,
    selectionEnd: range.start + nextBlock.length,
  };
}

export function indentTextLine(line: string) {
  return `  ${line}`;
}

export function outdentTextLine(line: string) {
  return line.replace(/^( {1,2}|\t)/, "");
}

export function duplicateSelectedLines(
  content: string,
  start: number,
  end: number,
): SourceEdit {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  const nextBlock = block.endsWith("\n") ? block : `${block}\n`;
  return {
    content: `${content.slice(0, range.end)}${nextBlock}${content.slice(range.end)}`,
    selectionStart: range.end,
    selectionEnd: range.end + nextBlock.length,
  };
}

export function moveSelectedLines(
  content: string,
  start: number,
  end: number,
  direction: -1 | 1,
): SourceEdit | null {
  const range = selectedLineRange(content, start, end);
  const block = content.slice(range.start, range.end);
  if (direction < 0) {
    if (range.start === 0) return null;
    const previousStart = content.lastIndexOf("\n", Math.max(0, range.start - 2)) + 1;
    const previousBlock = content.slice(previousStart, range.start);
    return {
      content: `${content.slice(0, previousStart)}${block}${previousBlock}${content.slice(range.end)}`,
      selectionStart: previousStart,
      selectionEnd: previousStart + block.length,
    };
  }
  if (range.end >= content.length) return null;
  const nextLineEndIndex = content.indexOf("\n", range.end);
  const nextEnd = nextLineEndIndex === -1 ? content.length : nextLineEndIndex + 1;
  const nextBlock = content.slice(range.end, nextEnd);
  return {
    content: `${content.slice(0, range.start)}${nextBlock}${block}${content.slice(nextEnd)}`,
    selectionStart: range.start + nextBlock.length,
    selectionEnd: range.start + nextBlock.length + block.length,
  };
}
