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

export interface MarkdownReference {
  kind: "link" | "image" | "footnote" | "definition" | "reference";
  line: number;
  start: number;
  end: number;
  label: string;
  target?: string;
}

export interface MarkdownFrontmatter {
  marker: "---" | "+++";
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  content: string;
}

export interface FrontmatterField {
  lineIndex: number;
  key: string;
  value: string;
}

export type MarkdownTableAlignment = "default" | "left" | "center" | "right";

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
  let offset = 0;
  let previousPlainLine = "";
  let previousPlainLineOffset = 0;
  let inFence = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      inFence = !inFence;
      offset += line.length + 1;
      return;
    }
    if (inFence) {
      offset += line.length + 1;
      return;
    }

    const footnoteDefinition = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (footnoteDefinition) {
      references.push({
        kind: "footnote",
        line: lineNumber,
        start: offset,
        end: offset + line.length,
        label: `[^${footnoteDefinition[1]}]`,
        target: footnoteDefinition[2],
      });
    } else {
      collectInlineMarkdownReferences(line, offset, lineNumber, references);
      const referenceDefinition = /^\[([^\]]+)\]:\s*(\S+)(?:\s+(.+))?$/.exec(line);
      if (referenceDefinition) {
        references.push({
          kind: "reference",
          line: lineNumber,
          start: offset,
          end: offset + line.length,
          label: referenceDefinition[1],
          target: referenceDefinition[2],
        });
      }
      const definition = /^\s*:\s+(.+)$/.exec(line);
      if (definition && previousPlainLine) {
        references.push({
          kind: "definition",
          line: lineNumber,
          start: previousPlainLineOffset,
          end: offset + line.length,
          label: previousPlainLine,
          target: definition[1],
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
    offset += line.length + 1;
  });

  return references;
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
    references.push({
      kind: "image",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1] || match[2],
      target: match[2],
    });
  }
  while ((match = linkPattern.exec(line))) {
    references.push({
      kind: "link",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: match[1],
      target: match[2],
    });
  }
  while ((match = footnotePattern.exec(line))) {
    references.push({
      kind: "footnote",
      line: lineNumber,
      start: lineOffset + match.index,
      end: lineOffset + match.index + match[0].length,
      label: `[^${match[1]}]`,
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

export function parseFrontmatter(content: string): MarkdownFrontmatter | null {
  const opening = /^(---|\+\+\+)[ \t]*\r?\n/.exec(content);
  if (!opening) return null;
  const marker = opening[1] as "---" | "+++";
  const contentStart = opening[0].length;
  const afterOpening = content.slice(contentStart);
  const closing = new RegExp(`(^|\\r?\\n)${escapeRegExp(marker)}[ \\t]*(?:\\r?\\n|$)`).exec(afterOpening);
  if (!closing) return null;
  const contentEnd = contentStart + closing.index;
  const end = contentStart + closing.index + closing[0].length;
  return {
    marker,
    start: 0,
    contentStart,
    contentEnd,
    end,
    content: content.slice(contentStart, contentEnd),
  };
}

export function replaceFrontmatterBody(content: string, body: string) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;
  const normalizedBody = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const bodyWithLineBreak = normalizedBody.endsWith("\n")
    ? normalizedBody
    : `${normalizedBody}\n`;
  return `${content.slice(0, frontmatter.contentStart)}${bodyWithLineBreak}${frontmatter.marker}\n${content.slice(frontmatter.end)}`;
}

export function parseFrontmatterFields(content: string, marker: "---" | "+++") {
  const separator = marker === "+++" ? "=" : ":";
  return content
    .split(/\r?\n/)
    .map((line, lineIndex): FrontmatterField | null => {
      const match = new RegExp(`^\\s*([A-Za-z0-9_.-]+)\\s*${separator}\\s*(.*?)\\s*$`).exec(line);
      if (!match) return null;
      return {
        lineIndex,
        key: match[1],
        value: match[2],
      };
    })
    .filter((field): field is FrontmatterField => Boolean(field));
}

export function formatFrontmatterField(key: string, value: string, marker: "---" | "+++") {
  return marker === "+++" ? `${key} = ${value}` : `${key}: ${value}`;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
