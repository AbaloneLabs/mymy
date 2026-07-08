import { parseFrontmatter } from "./markdownFrontmatter";
export {
  addFrontmatterFieldBody,
  deleteFrontmatterFieldBody,
  formatFrontmatterField,
  parseFrontmatter,
  parseFrontmatterFields,
  replaceFrontmatterBody,
  updateFrontmatterFieldBody,
} from "./markdownFrontmatter";
export type {
  FrontmatterField,
  MarkdownFrontmatter,
  MarkdownFrontmatterFormat,
} from "./markdownFrontmatter";

/**
 * Markdown editing combines source transformations, document metadata, and
 * lightweight navigation features. This module keeps those text-level rules
 * outside the React editor so preview rendering and toolbar state can change
 * without reworking outline, frontmatter, search, or footnote behavior.
 */
export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface MarkdownHeading {
  line: number;
  level: number;
  text: string;
}

export interface MarkdownHeadingAnchor {
  line: number;
  id: string;
  baseId: string;
  duplicateIndex: number;
  duplicateCount: number;
}

export interface MarkdownReference {
  kind: "link" | "image" | "footnote" | "definition" | "reference";
  line: number;
  start: number;
  end: number;
  label: string;
  target?: string;
  labelStart?: number;
  labelEnd?: number;
  targetStart?: number;
  targetEnd?: number;
}

export type MarkdownTableAlignment = "default" | "left" | "center" | "right";

const MARKDOWN_TOC_START = "<!-- mymy-toc:start -->";
const MARKDOWN_TOC_END = "<!-- mymy-toc:end -->";

export interface MarkdownTableModel {
  startLine: number;
  endLine: number;
  headers: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
}

export function markdownOutline(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFence = false;
  content.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) return;
    headings.push({
      line: index + 1,
      level: match[1].length,
      text: stripInlineMarkdown(match[2]),
    });
  });
  return headings;
}

export function markdownHeadingAnchors(headings: MarkdownHeading[]) {
  const totals = new Map<string, number>();
  headings.forEach((heading) => {
    const base = markdownHeadingSlug(heading.text) || `heading-${heading.line}`;
    totals.set(base, (totals.get(base) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  return headings.map((heading): MarkdownHeadingAnchor => {
    const base = markdownHeadingSlug(heading.text) || `heading-${heading.line}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return {
      line: heading.line,
      id: count === 0 ? base : `${base}-${count + 1}`,
      baseId: base,
      duplicateIndex: count + 1,
      duplicateCount: totals.get(base) ?? 1,
    };
  });
}

export function insertOrUpdateMarkdownToc(content: string, insertOffset: number) {
  const toc = buildMarkdownTableOfContents(content);
  if (!toc) return null;
  const existing = markdownTocRange(content);
  if (existing) {
    return {
      content: `${content.slice(0, existing.start)}${toc}${content.slice(existing.end)}`,
      selectionStart: existing.start,
      selectionEnd: existing.start + toc.length,
    };
  }
  const offset = Math.max(0, Math.min(content.length, insertOffset));
  const prefix = offset > 0 && !content.slice(0, offset).endsWith("\n") ? "\n\n" : "";
  const suffix = content.slice(offset).startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${prefix}${toc}${suffix}`;
  return {
    content: `${content.slice(0, offset)}${inserted}${content.slice(offset)}`,
    selectionStart: offset + prefix.length,
    selectionEnd: offset + prefix.length + toc.length,
  };
}

function buildMarkdownTableOfContents(content: string) {
  const existing = markdownTocRange(content);
  const headings = markdownOutline(content).filter((heading) => {
    if (existing && heading.line >= existing.startLine && heading.line <= existing.endLine) {
      return false;
    }
    return heading.text.trim().toLowerCase() !== "table of contents";
  });
  if (headings.length === 0) return null;
  const anchors = markdownHeadingAnchors(headings);
  const anchorByLine = new Map(anchors.map((anchor) => [anchor.line, anchor.id]));
  const minLevel = Math.min(...headings.map((heading) => heading.level));
  const lines = headings.map((heading) => {
    const depth = Math.max(0, heading.level - minLevel);
    const indent = "  ".repeat(depth);
    return `${indent}- [${escapeMarkdownLinkLabel(heading.text)}](#${anchorByLine.get(heading.line)})`;
  });
  return [
    MARKDOWN_TOC_START,
    ...lines,
    MARKDOWN_TOC_END,
  ].join("\n");
}

function markdownTocRange(content: string) {
  const start = content.indexOf(MARKDOWN_TOC_START);
  if (start === -1) return null;
  const endMarkerStart = content.indexOf(MARKDOWN_TOC_END, start);
  if (endMarkerStart === -1) return null;
  const end = endMarkerStart + MARKDOWN_TOC_END.length;
  return {
    start,
    end,
    startLine: lineForOffset(content, start),
    endLine: lineForOffset(content, end),
  };
}

export function markdownTables(content: string): MarkdownTableModel[] {
  const tables: MarkdownTableModel[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let lineIndex = 0;
  while (lineIndex < lines.length - 1) {
    const line = lines[lineIndex];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lineIndex += 1;
      continue;
    }
    if (inFence || !looksLikeMarkdownTableRow(line)) {
      lineIndex += 1;
      continue;
    }
    const separator = parseMarkdownTableSeparator(lines[lineIndex + 1]);
    if (!separator) {
      lineIndex += 1;
      continue;
    }
    const headers = parseMarkdownTableCells(line);
    if (headers.length < 2 || separator.length < 2) {
      lineIndex += 1;
      continue;
    }
    const width = Math.max(headers.length, separator.length);
    const rows: string[][] = [];
    let endLineIndex = lineIndex + 1;
    while (
      endLineIndex + 1 < lines.length &&
      looksLikeMarkdownTableRow(lines[endLineIndex + 1])
    ) {
      endLineIndex += 1;
      rows.push(normalizeMarkdownTableRow(parseMarkdownTableCells(lines[endLineIndex]), width));
    }
    tables.push({
      startLine: lineIndex + 1,
      endLine: endLineIndex + 1,
      headers: normalizeMarkdownTableRow(headers, width),
      alignments: normalizeMarkdownTableAlignments(separator, width),
      rows,
    });
    lineIndex = endLineIndex + 1;
  }
  return tables;
}

export function markdownTableAtLine(content: string, line: number) {
  return (
    markdownTables(content).find(
      (table) => line >= table.startLine && line <= table.endLine,
    ) ?? null
  );
}

export function replaceMarkdownTable(
  content: string,
  table: MarkdownTableModel,
  nextTable: MarkdownTableModel,
) {
  const lines = content.split("\n");
  lines.splice(
    table.startLine - 1,
    table.endLine - table.startLine + 1,
    ...serializeMarkdownTable(nextTable),
  );
  return lines.join("\n");
}

function looksLikeMarkdownTableRow(line: string) {
  return line.includes("|") && parseMarkdownTableCells(line).length >= 2;
}

function parseMarkdownTableSeparator(line: string) {
  if (!line.includes("|")) return null;
  const cells = parseMarkdownTableCells(line);
  if (
    cells.length < 2 ||
    cells.some((cell) => !/^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
  ) {
    return null;
  }
  return cells.map((cell): MarkdownTableAlignment => {
    const normalized = cell.trim();
    if (normalized.startsWith(":") && normalized.endsWith(":")) return "center";
    if (normalized.endsWith(":")) return "right";
    if (normalized.startsWith(":")) return "left";
    return "default";
  });
}

function parseMarkdownTableCells(line: string) {
  const trimmed = line.trim();
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      current += char;
      continue;
    }
    if (char === "|") {
      cells.push(unescapeMarkdownTableCell(current.trim()));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(unescapeMarkdownTableCell(current.trim()));
  return cells;
}

function normalizeMarkdownTableRow(row: string[], width: number) {
  return Array.from({ length: width }, (_, index) => row[index] ?? "");
}

function normalizeMarkdownTableAlignments(
  alignments: MarkdownTableAlignment[],
  width: number,
) {
  return Array.from(
    { length: width },
    (_, index) => alignments[index] ?? "default",
  );
}

function serializeMarkdownTable(table: MarkdownTableModel) {
  const width = Math.max(1, table.headers.length, table.alignments.length);
  const rows = table.rows.map((row) => normalizeMarkdownTableRow(row, width));
  const headers = normalizeMarkdownTableRow(table.headers, width);
  const alignments = normalizeMarkdownTableAlignments(table.alignments, width);
  const columnWidths = Array.from({ length: width }, (_, columnIndex) =>
    Math.max(
      3,
      escapedMarkdownTableCell(headers[columnIndex]).length,
      ...rows.map((row) => escapedMarkdownTableCell(row[columnIndex]).length),
    ),
  );
  return [
    markdownTableLine(headers, columnWidths),
    markdownTableSeparatorLine(alignments, columnWidths),
    ...rows.map((row) => markdownTableLine(row, columnWidths)),
  ];
}

function markdownTableLine(cells: string[], columnWidths: number[]) {
  return `| ${cells
    .map((cell, index) => escapedMarkdownTableCell(cell).padEnd(columnWidths[index], " "))
    .join(" | ")} |`;
}

function markdownTableSeparatorLine(
  alignments: MarkdownTableAlignment[],
  columnWidths: number[],
) {
  return `| ${alignments
    .map((alignment, index) => {
      const dashes = "-".repeat(Math.max(3, columnWidths[index]));
      if (alignment === "left") return `:${dashes.slice(1)}`;
      if (alignment === "right") return `${dashes.slice(0, -1)}:`;
      if (alignment === "center") return `:${dashes.slice(1, -1)}:`;
      return dashes;
    })
    .join(" | ")} |`;
}

function escapedMarkdownTableCell(value: string) {
  return value.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
}

function unescapeMarkdownTableCell(value: string) {
  return value.replace(/\\\|/g, "|");
}

export function markdownReferences(content: string): MarkdownReference[] {
  const references: MarkdownReference[] = [];
  const lines = content.split("\n");
  const lineOffsets = lineStartOffsets(lines);
  let previousPlainLine = "";
  let previousPlainLineOffset = 0;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const offset = lineOffsets[index] ?? 0;
    const lineNumber = index + 1;
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const footnoteDefinition = /^(\[\^([^\]]+)\]:\s*)(.*)$/.exec(line);
    if (footnoteDefinition) {
      const bodyStart = offset + footnoteDefinition[1].length;
      const continuationEndLine = footnoteDefinitionContinuationEnd(lines, index);
      const bodyEnd =
        (lineOffsets[continuationEndLine] ?? offset) +
        (lines[continuationEndLine]?.length ?? line.length);
      references.push({
        kind: "footnote",
        line: lineNumber,
        start: offset,
        end: bodyEnd,
        label: `[^${footnoteDefinition[2]}]`,
        target: content.slice(bodyStart, bodyEnd),
        labelStart: offset,
        labelEnd: offset + `[^${footnoteDefinition[2]}]`.length,
        targetStart: bodyStart,
        targetEnd: bodyEnd,
      });
    } else {
      collectInlineMarkdownReferences(line, offset, lineNumber, references);
      const referenceDefinition = /^(\[([^\]]+)\]:\s*)(\S+)(?:\s+(.+))?$/.exec(line);
      if (referenceDefinition) {
        const labelStart = offset + 1;
        const targetStart = offset + referenceDefinition[1].length;
        references.push({
          kind: "reference",
          line: lineNumber,
          start: offset,
          end: offset + line.length,
          label: referenceDefinition[2],
          target: referenceDefinition[3],
          labelStart,
          labelEnd: labelStart + referenceDefinition[2].length,
          targetStart,
          targetEnd: targetStart + referenceDefinition[3].length,
        });
      }
      const definition = /^(\s*:\s+)(.+)$/.exec(line);
      if (definition && previousPlainLine) {
        references.push({
          kind: "definition",
          line: lineNumber,
          start: previousPlainLineOffset,
          end: offset + line.length,
          label: previousPlainLine,
          target: definition[2],
          targetStart: offset + definition[1].length,
          targetEnd: offset + line.length,
        });
      }
    }

    const trimmed = line.trim();
    if (
      trimmed &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !trimmed.startsWith(":") &&
      !/^\[[^\]]+\]:/.test(trimmed)
    ) {
      previousPlainLine = stripInlineMarkdown(trimmed);
      previousPlainLineOffset = offset;
    } else if (!trimmed) {
      previousPlainLine = "";
      previousPlainLineOffset = offset;
    }
  }

  return references;
}

function lineStartOffsets(lines: string[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function footnoteDefinitionContinuationEnd(lines: string[], startIndex: number) {
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      const nextLine = lines[index + 1];
      if (nextLine && /^(?: {2,}|\t)/.test(nextLine)) {
        endIndex = index;
        continue;
      }
      break;
    }
    if (!/^(?: {2,}|\t)/.test(line)) break;
    endIndex = index;
  }
  return endIndex;
}

function collectInlineMarkdownReferences(
  line: string,
  lineOffset: number,
  lineNumber: number,
  references: MarkdownReference[],
) {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const linkPattern = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  const footnotePattern = /\[\^([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(line))) {
    const labelStart = lineOffset + match.index + 2;
    const targetStart = lineOffset + match.index + match[0].lastIndexOf("(") + 1;
    references.push({
      kind: "image",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1] || match[2],
      target: match[2],
      labelStart,
      labelEnd: labelStart + match[1].length,
      targetStart,
      targetEnd: targetStart + match[2].length,
    });
  }
  while ((match = linkPattern.exec(line))) {
    const labelStart = lineOffset + match.index + 1;
    const targetStart = lineOffset + match.index + match[0].lastIndexOf("(") + 1;
    references.push({
      kind: "link",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1],
      target: match[2],
      labelStart,
      labelEnd: labelStart + match[1].length,
      targetStart,
      targetEnd: targetStart + match[2].length,
    });
  }
  while ((match = footnotePattern.exec(line))) {
    references.push({
      kind: "footnote",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: `[^${match[1]}]`,
      labelStart: lineOffset + match.index,
      labelEnd: lineOffset + match.index + match[0].length,
    });
  }
}

export function markdownStats(content: string, headings: number) {
  const lines = Math.max(1, content.split("\n").length);
  const words = stripInlineMarkdown(stripFrontmatter(content))
    .split(/\s+/)
    .filter(Boolean).length;
  return {
    lines,
    words,
    characters: content.length,
    headings,
  };
}

function stripFrontmatter(content: string) {
  const frontmatter = parseFrontmatter(content);
  return frontmatter ? content.slice(frontmatter.end) : content;
}

export function indentMarkdownLine(line: string) {
  return `  ${line}`;
}

export function outdentMarkdownLine(line: string) {
  return line.replace(/^( {1,2}|\t)/, "");
}

export function offsetForLine(content: string, line: number) {
  if (line <= 1) return 0;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = content.indexOf("\n", offset);
    if (next === -1) return content.length;
    offset = next + 1;
  }
  return offset;
}

export function lineForOffset(content: string, offset: number) {
  return content.slice(0, offset).split("\n").length;
}

export function nextMarkdownFootnoteId(content: string) {
  const existing = new Set<string>();
  const pattern = /\[\^([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) existing.add(match[1]);
  let index = 1;
  while (existing.has(`note${index}`)) index += 1;
  return `note${index}`;
}

export function insertFootnoteReference(
  content: string,
  id: string,
  start: number,
  end: number,
) {
  const reference = `[^${id}]`;
  const withReference = `${content.slice(0, start)}${reference}${content.slice(end)}`;
  const next = appendFootnoteDefinition(withReference, id);
  return {
    content: next,
    selectionStart: start + reference.length,
    selectionEnd: start + reference.length,
  };
}

function appendFootnoteDefinition(content: string, id: string) {
  const definitionPattern = new RegExp(`^\\[\\^${escapeRegExp(id)}\\]:`, "m");
  if (definitionPattern.test(content)) return content;
  const separator = content.endsWith("\n\n")
    ? ""
    : content.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${content}${separator}[^${id}]: Footnote\n`;
}

export function isMarkdownUrl(value: string) {
  return /^(https?:\/\/|mailto:|\/drive\/|\.{0,2}\/|#)/i.test(value);
}

export function hasTrailingTextNewline(content: string) {
  return content.endsWith("\n") || content.endsWith("\r");
}

export function isMarkdownHeadingKey(value: string): value is `${MarkdownHeadingLevel}` {
  return /^[1-6]$/.test(value);
}

export function buildMarkdownSearchRegex(
  query: string,
  options: { matchCase: boolean; wholeWord?: boolean; regexSearch?: boolean },
) {
  if (!query) return null;
  const source = options.regexSearch ? query : escapeRegExp(query);
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, options.matchCase ? "g" : "gi");
  } catch {
    return null;
  }
}

export function countMarkdownSearchMatches(
  content: string,
  query: string,
  options: { matchCase: boolean; wholeWord?: boolean; regexSearch?: boolean },
) {
  const regex = buildMarkdownSearchRegex(query, options);
  if (!regex) return 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    if (match[0].length === 0) break;
    count += 1;
  }
  return count;
}

export function nextMarkdownSearchRange(
  content: string,
  query: string,
  options: {
    matchCase: boolean;
    wholeWord?: boolean;
    regexSearch?: boolean;
    start: number;
  },
) {
  const regex = buildMarkdownSearchRegex(query, options);
  if (!regex) return null;
  regex.lastIndex = options.start;
  let match = regex.exec(content);
  if (!match) {
    regex.lastIndex = 0;
    match = regex.exec(content);
  }
  if (!match || match[0].length === 0) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
  };
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]/g, "")
    .trim();
}

function markdownHeadingSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
