import type {
  MarkdownTableAlignment,
  MarkdownTableCellSpan,
  MarkdownTableModel,
} from "./markdownTypes";

export function markdownTables(content: string): MarkdownTableModel[] {
  const tables: MarkdownTableModel[] = [];
  const lines = content.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  lines.forEach((line) => {
    lineOffsets.push(offset);
    offset += line.length + 1;
  });
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
    const separatorRow = parseMarkdownTableRow(lines[lineIndex + 1]);
    const separator = parseMarkdownTableSeparator(separatorRow);
    if (!separator) {
      lineIndex += 1;
      continue;
    }
    const headerRow = parseMarkdownTableRow(line);
    const headers = headerRow.cells;
    if (headers.length < 2 || separator.length < 2) {
      lineIndex += 1;
      continue;
    }
    const width = Math.max(headers.length, separator.length);
    const rows: string[][] = [];
    const rowSpans: MarkdownTableCellSpan[][] = [];
    let endLineIndex = lineIndex + 1;
    while (
      endLineIndex + 1 < lines.length &&
      looksLikeMarkdownTableRow(lines[endLineIndex + 1])
    ) {
      endLineIndex += 1;
      const parsedRow = parseMarkdownTableRow(lines[endLineIndex]);
      rows.push(normalizeMarkdownTableRow(parsedRow.cells, width));
      rowSpans.push(
        absoluteMarkdownTableSpans(
          parsedRow.spans,
          lineOffsets[endLineIndex],
          width,
        ),
      );
    }
    tables.push({
      startLine: lineIndex + 1,
      endLine: endLineIndex + 1,
      headers: normalizeMarkdownTableRow(headers, width),
      headerSpans: absoluteMarkdownTableSpans(
        headerRow.spans,
        lineOffsets[lineIndex],
        width,
      ),
      alignments: normalizeMarkdownTableAlignments(separator, width),
      alignmentSpans: absoluteMarkdownTableSpans(
        separatorRow.spans,
        lineOffsets[lineIndex + 1],
        width,
      ),
      rows,
      rowSpans,
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
  return line.includes("|") && parseMarkdownTableRow(line).cells.length >= 2;
}

function parseMarkdownTableSeparator(row: ReturnType<typeof parseMarkdownTableRow>) {
  const cells = row.cells;
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

function parseMarkdownTableRow(line: string) {
  const delimiters: number[] = [];
  let escaped = false;
  let codeFenceLength = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") {
      let runLength = 1;
      while (line[index + runLength] === "`") runLength += 1;
      if (codeFenceLength === 0) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      index += runLength - 1;
      continue;
    }
    if (char === "|" && codeFenceLength === 0) delimiters.push(index);
  }
  const firstContent = line.search(/\S/);
  if (firstContent < 0) return { cells: [], spans: [] };
  let contentStart = firstContent;
  let contentEnd = line.trimEnd().length;
  if (line[contentStart] === "|") contentStart += 1;
  if (contentEnd > contentStart && line[contentEnd - 1] === "|") contentEnd -= 1;
  const innerDelimiters = delimiters.filter(
    (index) => index >= contentStart && index < contentEnd,
  );
  const boundaries = [contentStart, ...innerDelimiters, contentEnd];
  const cells: string[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const rawStart = boundaries[index] + (index === 0 ? 0 : 1);
    const rawEnd = boundaries[index + 1];
    const raw = line.slice(rawStart, rawEnd);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = rawStart + leading;
    const end = Math.max(start, rawEnd - trailing);
    cells.push(unescapeMarkdownTableCell(line.slice(start, end)));
    spans.push({ start, end });
  }
  return { cells, spans };
}

function absoluteMarkdownTableSpans(
  spans: Array<{ start: number; end: number }>,
  lineOffset: number,
  width: number,
) {
  return Array.from({ length: width }, (_, index) => {
    const span = spans[index] ?? spans.at(-1) ?? { start: 0, end: 0 };
    return { start: lineOffset + span.start, end: lineOffset + span.end };
  });
}

export function patchMarkdownTableCell(
  content: string,
  span: MarkdownTableCellSpan | undefined,
  value: string,
) {
  if (!span || span.start < 0 || span.end < span.start || span.end > content.length) {
    return content;
  }
  return `${content.slice(0, span.start)}${escapedMarkdownTableCell(value)}${content.slice(span.end)}`;
}

export function patchMarkdownTableAlignment(
  content: string,
  span: MarkdownTableCellSpan | undefined,
  alignment: MarkdownTableAlignment,
) {
  if (!span) return content;
  const current = content.slice(span.start, span.end);
  const dashCount = Math.max(3, current.replace(/[^-]/g, "").length);
  const dashes = "-".repeat(dashCount);
  const value =
    alignment === "left"
      ? `:${dashes}`
      : alignment === "right"
        ? `${dashes}:`
        : alignment === "center"
          ? `:${dashes}:`
          : dashes;
  return `${content.slice(0, span.start)}${value}${content.slice(span.end)}`;
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
