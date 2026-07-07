import { columnName } from "./models";

export interface CellPosition {
  row: number;
  column: number;
}

export interface NormalizedCellRange {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SpreadsheetViewport {
  scrollTop: number;
  scrollLeft: number;
  width: number;
  height: number;
}

export const SPREADSHEET_ROW_HEIGHT = 32;
export const SPREADSHEET_COLUMN_WIDTH = 128;
export const SPREADSHEET_ROW_HEADER_WIDTH = 48;
export const SPREADSHEET_HEADER_HEIGHT = 32;
export const DEFAULT_XLSX_COLUMN_WIDTH = 16;
export const DEFAULT_XLSX_ROW_HEIGHT = 24;
export const MIN_XLSX_VISIBLE_COLUMNS = 702;
export const MIN_XLSX_VISIBLE_ROWS = 1000;
export const MIN_DELIMITED_VISIBLE_COLUMNS = MIN_XLSX_VISIBLE_COLUMNS;
export const MIN_DELIMITED_VISIBLE_ROWS = MIN_XLSX_VISIBLE_ROWS;

export const emptyViewport: SpreadsheetViewport = {
  scrollTop: 0,
  scrollLeft: 0,
  width: 0,
  height: 0,
};

export function virtualWindow(
  total: number,
  scrollOffset: number,
  viewportSize: number,
  itemSize: number,
  overscan: number,
) {
  if (total <= 0) return { start: 0, end: 0 };
  const safeViewport = Math.max(viewportSize, itemSize * 8);
  const firstVisible = Math.floor(Math.max(0, scrollOffset) / itemSize);
  const visibleCount = Math.ceil(safeViewport / itemSize);
  const start = Math.min(total - 1, Math.max(0, firstVisible - overscan));
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  return { start, end: Math.min(total, Math.max(start + 1, end)) };
}

export function indexRange(start: number, end: number) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

export function rangeIndexes(start: number, end: number) {
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, index) => start + index,
  );
}

export function spacerColumnCount(
  window: { start: number; end: number },
  totalColumns: number,
) {
  return (window.start > 0 ? 1 : 0) + (window.end < totalColumns ? 1 : 0);
}

export function viewportFromElement(element: HTMLDivElement): SpreadsheetViewport {
  return {
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    width: element.clientWidth,
    height: element.clientHeight,
  };
}

export function scrollCellIntoView(
  element: HTMLDivElement | null,
  row: number,
  column: number,
) {
  if (!element) return;
  const targetTop = SPREADSHEET_HEADER_HEIGHT + row * SPREADSHEET_ROW_HEIGHT;
  const targetBottom = targetTop + SPREADSHEET_ROW_HEIGHT;
  const targetLeft =
    SPREADSHEET_ROW_HEADER_WIDTH + column * SPREADSHEET_COLUMN_WIDTH;
  const targetRight = targetLeft + SPREADSHEET_COLUMN_WIDTH;

  if (targetTop < element.scrollTop) {
    element.scrollTop = targetTop;
  } else if (targetBottom > element.scrollTop + element.clientHeight) {
    element.scrollTop = targetBottom - element.clientHeight;
  }

  if (targetLeft < element.scrollLeft + SPREADSHEET_ROW_HEADER_WIDTH) {
    element.scrollLeft = Math.max(0, targetLeft - SPREADSHEET_ROW_HEADER_WIDTH);
  } else if (targetRight > element.scrollLeft + element.clientWidth) {
    element.scrollLeft = targetRight - element.clientWidth;
  }
}

export function normalizeCellRange(
  start: CellPosition | null,
  end: CellPosition | null,
): NormalizedCellRange | null {
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    right: Math.max(start.column, end.column),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
  };
}

export function rangeCoversSheet(
  range: NormalizedCellRange | null,
  rowCount: number,
  columnCount: number,
) {
  return Boolean(
    range &&
      range.top <= 0 &&
      range.left <= 0 &&
      range.bottom >= Math.max(0, rowCount - 1) &&
      range.right >= Math.max(0, columnCount - 1),
  );
}

export function rangeCoversColumn(
  range: NormalizedCellRange | null,
  column: number,
  rowCount: number,
) {
  return Boolean(
    range &&
      range.left <= column &&
      range.right >= column &&
      range.top <= 0 &&
      range.bottom >= Math.max(0, rowCount - 1),
  );
}

export function rangeCoversRow(
  range: NormalizedCellRange | null,
  row: number,
  columnCount: number,
) {
  return Boolean(
    range &&
      range.top <= row &&
      range.bottom >= row &&
      range.left <= 0 &&
      range.right >= Math.max(0, columnCount - 1),
  );
}

export function singleCellRange(range: NormalizedCellRange) {
  return range.top === range.bottom && range.left === range.right;
}

export function rangeToA1(range: NormalizedCellRange) {
  return `${columnName(range.left)}${range.top + 1}:${columnName(range.right)}${range.bottom + 1}`;
}

export function xlsxRangeFromRef(ref: string): NormalizedCellRange | null {
  const [start, end = start] = ref.split(":");
  const startPosition = xlsxCellPositionFromRef(start);
  const endPosition = xlsxCellPositionFromRef(end);
  if (!startPosition || !endPosition) return null;
  return {
    top: Math.min(startPosition.row, endPosition.row),
    right: Math.max(startPosition.column, endPosition.column),
    bottom: Math.max(startPosition.row, endPosition.row),
    left: Math.min(startPosition.column, endPosition.column),
  };
}

export function clampCellRange(
  range: NormalizedCellRange,
  rowCount: number,
  columnCount: number,
): NormalizedCellRange {
  const maxRow = Math.max(0, rowCount - 1);
  const maxColumn = Math.max(0, columnCount - 1);
  return {
    top: Math.min(maxRow, Math.max(0, range.top)),
    right: Math.min(maxColumn, Math.max(0, range.right)),
    bottom: Math.min(maxRow, Math.max(0, range.bottom)),
    left: Math.min(maxColumn, Math.max(0, range.left)),
  };
}

export function xlsxCellPositionFromRef(
  ref: string | undefined,
): CellPosition | null {
  if (!ref) return null;
  const match = /^([A-Z]+)(\d+)$/i.exec(ref.replace(/\$/g, ""));
  if (!match) return null;
  return {
    row: Math.max(0, Number(match[2]) - 1),
    column: columnIndexFromName(match[1]),
  };
}

export function columnIndexFromName(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
