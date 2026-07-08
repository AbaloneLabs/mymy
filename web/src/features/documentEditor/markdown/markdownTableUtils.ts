import type { MarkdownTableAlignment, MarkdownTableModel } from "./markdownTypes";

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
