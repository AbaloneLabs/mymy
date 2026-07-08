import type { CSSProperties } from "react";
import type { DocxBlock, DocxComment, DocxNote, DocxPageSettings } from "./models";

/**
 * DOCX editing stores document layout in Word-compatible units and keeps block
 * identity stable while users split, merge, paste, and reorder content. These
 * helpers centralize the unit conversions, id allocation, table normalization,
 * and DOM focus utilities needed by the editor so the React component can stay
 * focused on command handling and rendering.
 */
export const TWIPS_PER_INCH = 1440;
export const DEFAULT_DOCX_TABLE_COLUMN_WIDTH = 2400;
export const MIN_DOCX_TABLE_COLUMN_WIDTH = 720;
export const MAX_DOCX_TABLE_COLUMN_WIDTH = 14400;
export const DEFAULT_DOCX_TABLE_ROW_HEIGHT = 360;
export const MIN_DOCX_TABLE_ROW_HEIGHT = 240;
export const MAX_DOCX_TABLE_ROW_HEIGHT = 7200;

const DOCX_HEADING_FONT_SIZES: Record<number, string> = {
  1: "32",
  2: "28",
  3: "24",
  4: "20",
  5: "18",
  6: "16",
};

export const DOCX_PAGE_PRESETS = [
  { label: "Letter", value: "letter", width: 12_240, height: 15_840 },
  { label: "A4", value: "a4", width: 11_906, height: 16_838 },
  { label: "Legal", value: "legal", width: 12_240, height: 20_160 },
] as const;

export const DOCX_TABLE_STYLES = [
  { label: "Plain", value: "" },
  { label: "Grid", value: "TableGrid" },
  { label: "Light list", value: "LightList" },
  { label: "Medium grid", value: "MediumGrid1" },
] as const;

export const DEFAULT_DOCX_TABLE_BORDER_COLOR = "#A3A3A3";
export const DEFAULT_DOCX_TABLE_BACKGROUND = "#FFFFFF";
export const DEFAULT_DOCX_TABLE_HEADER_BACKGROUND = "#F5F5F5";
export const DEFAULT_DOCX_TABLE_BORDER_SIZE = 4;

const DOCX_FORMAT_KEYS = [
  "type",
  "headingLevel",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "verticalAlign",
  "fontFamily",
  "fontSize",
  "color",
  "highlight",
  "align",
  "listKind",
  "indentLeft",
  "spacingBefore",
  "spacingAfter",
  "lineSpacing",
  "pageBreakBefore",
] as const;

export type DocxFormatClipboard = Partial<
  Pick<DocxBlock, (typeof DOCX_FORMAT_KEYS)[number]>
>;

export function docxPageStyle(page: DocxPageSettings | undefined): CSSProperties {
  const width = page?.width ? twipsToCssPixels(page.width) : 816;
  const minHeight = page?.height ? twipsToCssPixels(page.height) : 980;
  return {
    width,
    minHeight,
    paddingTop:
      page?.marginTop !== undefined ? twipsToCssPixels(page.marginTop) : 64,
    paddingRight:
      page?.marginRight !== undefined ? twipsToCssPixels(page.marginRight) : 80,
    paddingBottom:
      page?.marginBottom !== undefined ? twipsToCssPixels(page.marginBottom) : 64,
    paddingLeft:
      page?.marginLeft !== undefined ? twipsToCssPixels(page.marginLeft) : 80,
  };
}

export function headingFontSize(level: number) {
  return DOCX_HEADING_FONT_SIZES[level] ?? DOCX_HEADING_FONT_SIZES[1];
}

export function docxPagePresetValue(page: DocxPageSettings | undefined) {
  const width = page?.width ?? DOCX_PAGE_PRESETS[0].width;
  const height = page?.height ?? DOCX_PAGE_PRESETS[0].height;
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);
  return (
    DOCX_PAGE_PRESETS.find(
      (preset) =>
        preset.width === portraitWidth && preset.height === portraitHeight,
    )?.value ?? "custom"
  );
}

export function tableColumnCount(rows: string[][]) {
  return Math.max(1, ...rows.map((row) => row.length));
}

export function normalizeDocxTableRow(row: string[], columnCount: number) {
  if (row.length >= columnCount) return row;
  return [...row, ...Array(columnCount - row.length).fill("")];
}

export function normalizeDocxTableColumnWidths(
  widths: number[] | undefined,
  columnCount: number,
) {
  return Array.from({ length: columnCount }, (_, index) =>
    Math.min(
      MAX_DOCX_TABLE_COLUMN_WIDTH,
      Math.max(
        MIN_DOCX_TABLE_COLUMN_WIDTH,
        Math.round(widths?.[index] ?? DEFAULT_DOCX_TABLE_COLUMN_WIDTH),
      ),
    ),
  );
}

export function normalizeDocxTableRowHeights(
  heights: number[] | undefined,
  rowCount: number,
) {
  return Array.from({ length: rowCount }, (_, index) =>
    Math.min(
      MAX_DOCX_TABLE_ROW_HEIGHT,
      Math.max(
        MIN_DOCX_TABLE_ROW_HEIGHT,
        Math.round(heights?.[index] ?? DEFAULT_DOCX_TABLE_ROW_HEIGHT),
      ),
    ),
  );
}

export function clampTableCell(
  cell: { row: number; column: number } | null,
  rowCount: number,
  columnCount: number,
) {
  if (!cell) return null;
  return {
    row: Math.max(0, Math.min(rowCount - 1, cell.row)),
    column: Math.max(0, Math.min(columnCount - 1, cell.column)),
  };
}

export function tableClipboardMatrix(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((row) => row.split("\t"));
}

export function pointsToTwips(points: number) {
  if (!Number.isFinite(points)) return 0;
  return Math.max(0, Math.round(points * 20));
}

export function twipsToPoints(twips: number) {
  return Math.round((twips / 20) * 10) / 10;
}

export function inchesToTwips(inches: number) {
  if (!Number.isFinite(inches)) return 0;
  return Math.max(0, Math.round(inches * TWIPS_PER_INCH));
}

export function twipsToInches(twips: number) {
  return Math.round((twips / TWIPS_PER_INCH) * 10) / 10;
}

export function twipsToCssPixels(twips: number) {
  return (twips / 20) * (4 / 3);
}

export function clampImageDimension(value: number) {
  if (!Number.isFinite(value)) return 16;
  return Math.max(16, Math.min(10_000, Math.round(value)));
}

export function clampImageRotation(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-360, Math.min(360, Math.round(value)));
}

export function clampImageCropPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function readImageDisplaySize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth || 320;
      const naturalHeight = image.naturalHeight || 180;
      const maxWidth = 520;
      const scale = naturalWidth > maxWidth ? maxWidth / naturalWidth : 1;
      resolve({
        width: clampImageDimension(naturalWidth * scale),
        height: clampImageDimension(naturalHeight * scale),
      });
    };
    image.onerror = () => resolve({ width: 320, height: 180 });
    image.src = dataUrl;
  });
}

export function isDocxTextBlock(
  block: DocxBlock | undefined,
): block is DocxBlock & { type: "paragraph" | "heading" } {
  return block?.type === "paragraph" || block?.type === "heading";
}

export function pickDocxFormatting(block: DocxBlock): DocxFormatClipboard {
  return Object.fromEntries(
    DOCX_FORMAT_KEYS.map((key) => [key, block[key]]).filter(
      ([, value]) => value !== undefined,
    ),
  ) as DocxFormatClipboard;
}

export function sectionBreakLabel(kind: DocxBlock["breakKind"]) {
  if (kind === "continuous") return "continuous";
  if (kind === "evenPage") return "even page";
  if (kind === "oddPage") return "odd page";
  return "next page";
}

export function nextDocxNoteId(
  notes: DocxNote[],
  blocks: DocxBlock[],
  key: "footnoteId" | "endnoteId",
) {
  const usedIds = new Set<string>();
  notes.forEach((note) => usedIds.add(note.id));
  blocks.forEach((block) => {
    const id = block[key];
    if (id) usedIds.add(id);
  });
  let index =
    Math.max(
      0,
      ...Array.from(usedIds)
        .map((id) => Number.parseInt(id, 10))
        .filter(Number.isFinite),
    ) + 1;
  while (usedIds.has(String(index))) {
    index += 1;
  }
  return String(index);
}

export function nextDocxCommentId(comments: DocxComment[], blocks: DocxBlock[]) {
  const usedIds = new Set<string>();
  comments.forEach((comment) => usedIds.add(comment.id));
  blocks.forEach((block) => {
    if (block.commentId) usedIds.add(block.commentId);
  });
  let index =
    Math.max(
      -1,
      ...Array.from(usedIds)
        .map((id) => Number.parseInt(id, 10))
        .filter(Number.isFinite),
    ) + 1;
  while (usedIds.has(String(index))) {
    index += 1;
  }
  return String(index);
}

export function nextDocxBlockId(
  blocks: DocxBlock[],
  prefix: "p" | "tbl" | "img" | "br" | "sect",
) {
  return allocateDocxBlockId(new Set(blocks.map((block) => block.id)), prefix);
}

export function allocateDocxBlockId(
  usedIds: Set<string>,
  prefix: "p" | "tbl" | "img" | "br" | "sect",
) {
  let index = usedIds.size + 1;
  let id = `${prefix}${index}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  usedIds.add(id);
  return id;
}

export function textOffsetWithin(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return element.textContent?.length ?? 0;
  }
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) {
    return element.textContent?.length ?? 0;
  }
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

export function focusDocxBlock(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-docx-block="${CSS.escape(id)}"]`,
  );
  if (!element) return;
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
