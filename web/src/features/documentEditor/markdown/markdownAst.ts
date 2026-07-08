export type MarkdownAstBlockType =
  | "blank"
  | "blockquote"
  | "code"
  | "frontmatter"
  | "heading"
  | "html"
  | "list"
  | "paragraph"
  | "table"
  | "thematicBreak";

export interface MarkdownAstBlock {
  type: MarkdownAstBlockType;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  raw: string;
  headingLevel?: number;
  headingText?: string;
  fence?: string;
}

interface MarkdownLineRecord {
  line: string;
  lineNumber: number;
  raw: string;
  startOffset: number;
  endOffset: number;
}

/**
 * This parser is deliberately lossless rather than normalizing to CommonMark
 * tokens. Editors need stable source ranges for folding, preview mapping, TOC
 * updates, and frontmatter edits while preserving the user's original Markdown
 * spelling, comments, whitespace, and embedded HTML.
 */
export function parseMarkdownAst(content: string): MarkdownAstBlock[] {
  const lines = markdownLineRecords(content);
  const blocks: MarkdownAstBlock[] = [];
  let index = 0;
  const frontmatterEnd = markdownFrontmatterEnd(lines);
  if (frontmatterEnd !== null) {
    blocks.push(markdownBlock("frontmatter", lines, 0, frontmatterEnd));
    index = frontmatterEnd + 1;
  }
  while (index < lines.length) {
    const current = lines[index];
    const trimmed = current.line.trim();
    if (!trimmed) {
      blocks.push(markdownBlock("blank", lines, index, index));
      index += 1;
      continue;
    }
    const fence = /^(\s*)(```|~~~)/.exec(current.line);
    if (fence) {
      const end = markdownFenceEnd(lines, index, fence[2]);
      blocks.push({
        ...markdownBlock("code", lines, index, end),
        fence: fence[2],
      });
      index = end + 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(current.line);
    if (heading) {
      blocks.push({
        ...markdownBlock("heading", lines, index, index),
        headingLevel: heading[1].length,
        headingText: heading[2],
      });
      index += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(markdownBlock("thematicBreak", lines, index, index));
      index += 1;
      continue;
    }
    if (markdownTableStartsAt(lines, index)) {
      const end = markdownTableEnd(lines, index);
      blocks.push(markdownBlock("table", lines, index, end));
      index = end + 1;
      continue;
    }
    if (/^\s*>/.test(current.line)) {
      const end = markdownContinuationEnd(lines, index, (line) => /^\s*>/.test(line) || !line.trim());
      blocks.push(markdownBlock("blockquote", lines, index, end));
      index = end + 1;
      continue;
    }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(current.line)) {
      const end = markdownContinuationEnd(
        lines,
        index,
        (line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/.test(line) || !line.trim(),
      );
      blocks.push(markdownBlock("list", lines, index, end));
      index = end + 1;
      continue;
    }
    if (/^\s*<\/?[A-Za-z][^>]*>/.test(current.line)) {
      const end = markdownContinuationEnd(lines, index, (line) => Boolean(line.trim()));
      blocks.push(markdownBlock("html", lines, index, end));
      index = end + 1;
      continue;
    }
    const end = markdownContinuationEnd(lines, index, (line) => Boolean(line.trim()));
    blocks.push(markdownBlock("paragraph", lines, index, end));
    index = end + 1;
  }
  return blocks;
}

export function serializeMarkdownAst(blocks: MarkdownAstBlock[]) {
  return blocks.map((block) => block.raw).join("");
}

function markdownLineRecords(content: string): MarkdownLineRecord[] {
  if (content.length === 0) {
    return [{ line: "", lineNumber: 1, raw: "", startOffset: 0, endOffset: 0 }];
  }
  const records: MarkdownLineRecord[] = [];
  let offset = 0;
  content.split(/(\r?\n)/).reduce((pending, part, index, parts) => {
    if (index % 2 === 0) {
      if (index === parts.length - 1 && part === "") return "";
      return part;
    }
    const line = pending;
    const startOffset = offset;
    offset += line.length + part.length;
    records.push({
      line,
      lineNumber: records.length + 1,
      raw: `${line}${part}`,
      startOffset,
      endOffset: offset,
    });
    return "";
  }, "");
  if (offset < content.length) {
    records.push({
      line: content.slice(offset),
      lineNumber: records.length + 1,
      raw: content.slice(offset),
      startOffset: offset,
      endOffset: content.length,
    });
  }
  return records;
}

function markdownBlock(
  type: MarkdownAstBlockType,
  lines: MarkdownLineRecord[],
  startIndex: number,
  endIndex: number,
): MarkdownAstBlock {
  const first = lines[startIndex];
  const last = lines[endIndex] ?? first;
  return {
    type,
    startLine: first.lineNumber,
    endLine: last.lineNumber,
    startOffset: first.startOffset,
    endOffset: last.endOffset,
    raw: lines
      .slice(startIndex, endIndex + 1)
      .map((line) => line.raw ?? "")
      .join("") || "",
  };
}

function markdownFrontmatterEnd(lines: MarkdownLineRecord[]) {
  const marker = lines[0]?.line.trim();
  if (marker !== "---" && marker !== "+++") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].line.trim() === marker) return index;
  }
  return null;
}

function markdownFenceEnd(
  lines: MarkdownLineRecord[],
  startIndex: number,
  fence: string,
) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].line.trimStart().startsWith(fence)) return index;
  }
  return lines.length - 1;
}

function markdownTableStartsAt(lines: MarkdownLineRecord[], index: number) {
  const header = lines[index]?.line ?? "";
  const separator = lines[index + 1]?.line ?? "";
  return header.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator);
}

function markdownTableEnd(lines: MarkdownLineRecord[], startIndex: number) {
  let index = startIndex + 2;
  while (index < lines.length && lines[index].line.includes("|") && lines[index].line.trim()) {
    index += 1;
  }
  return index - 1;
}

function markdownContinuationEnd(
  lines: MarkdownLineRecord[],
  startIndex: number,
  shouldContinue: (line: string) => boolean,
) {
  let index = startIndex + 1;
  while (index < lines.length && shouldContinue(lines[index].line)) {
    index += 1;
  }
  return index - 1;
}
