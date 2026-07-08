import type { DocumentEditorKind } from "@/types/documentEditor";

export function documentEditorKindLabel(kind: DocumentEditorKind) {
  if (kind === "docx") return "DOCX";
  if (kind === "xlsx") return "XLSX";
  if (kind === "pptx") return "PPTX";
  if (kind === "markdown") return "Markdown";
  if (kind === "csv") return "CSV";
  if (kind === "tsv") return "TSV";
  if (kind === "preview") return "Preview";
  return "Text";
}

export function documentEditorStatusItems(kind: DocumentEditorKind, model: unknown) {
  if (!isPlainRecord(model)) return [];
  if (typeof model.content === "string") {
    return compactStatusItems([
      `${lineCount(model.content)} lines`,
      `${model.content.length} chars`,
      typeof model.encoding === "string" ? model.encoding : null,
      typeof model.lineEnding === "string" ? lineEndingLabel(model.lineEnding) : null,
      model.bom === true ? "BOM" : null,
      model.trailingNewline === false ? "no final newline" : null,
    ]);
  }
  if (Array.isArray(model.rows)) {
    const rows = model.rows.filter(Array.isArray);
    return compactStatusItems([
      `${rows.length} rows`,
      `${maxRowLength(rows)} columns`,
      typeof model.encoding === "string" ? model.encoding : null,
      typeof model.lineEnding === "string" ? lineEndingLabel(model.lineEnding) : null,
      model.bom === true ? "BOM" : null,
      model.trailingNewline === false ? "no final newline" : null,
    ]);
  }
  if (Array.isArray(model.blocks)) {
    const blocks = model.blocks.filter(isPlainRecord);
    return compactStatusItems([
      `${blocks.length} blocks`,
      `${blocks.filter((block) => block.type === "table").length} tables`,
      `${blocks.filter((block) => block.type === "image").length} images`,
      `${arrayLength(model.headers) + arrayLength(model.footers)} headers/footers`,
      `${arrayLength(model.comments)} comments`,
      `${arrayLength(model.footnotes) + arrayLength(model.endnotes)} notes`,
    ]);
  }
  if (Array.isArray(model.sheets)) {
    const sheets = model.sheets.filter(isPlainRecord);
    return compactStatusItems([
      `${sheets.length} sheets`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.rows), 0)} rows`,
      `${sheets.reduce((count, sheet) => count + sheetCellCount(sheet), 0)} cells`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.charts), 0)} charts`,
      `${sheets.reduce((count, sheet) => count + arrayLength(sheet.pivots), 0)} pivots`,
    ]);
  }
  if (Array.isArray(model.slides)) {
    const slides = model.slides.filter(isPlainRecord);
    return compactStatusItems([
      `${slides.length} slides`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.texts), 0)} text boxes`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.shapes), 0)} shapes`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.images), 0)} images`,
      `${slides.reduce((count, slide) => count + arrayLength(slide.charts), 0)} charts`,
    ]);
  }
  return compactStatusItems([documentEditorKindLabel(kind)]);
}

function compactStatusItems(items: Array<string | null>) {
  return items.filter((item): item is string => Boolean(item));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function sheetCellCount(sheet: Record<string, unknown>) {
  if (!Array.isArray(sheet.rows)) return 0;
  return sheet.rows.reduce((count, row) => {
    if (!isPlainRecord(row) || !Array.isArray(row.cells)) return count;
    return count + row.cells.length;
  }, 0);
}

function maxRowLength(rows: unknown[][]) {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

function lineCount(content: string) {
  return content.length === 0 ? 1 : content.split("\n").length;
}

function lineEndingLabel(value: string) {
  if (value === "\r\n") return "CRLF";
  if (value === "\r") return "CR";
  if (value === "\n") return "LF";
  return value;
}
