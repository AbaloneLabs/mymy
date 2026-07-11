import { compareSpreadsheetValues } from "./spreadsheetData";
import {
  DEFAULT_XLSX_COLUMN_WIDTH,
  DEFAULT_XLSX_ROW_HEIGHT,
  MIN_XLSX_VISIBLE_COLUMNS,
  MIN_XLSX_VISIBLE_ROWS,
  indexRange,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import { adjustSpreadsheetFormulaReferences } from "./spreadsheetFormulaReferences";
import { rangesOverlap, xlsxSqrefRanges } from "./spreadsheetXlsxMetadata";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type {
  XlsxCell,
  XlsxColumn,
  XlsxModel,
  XlsxRow,
  XlsxSheet,
} from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";

export function valuesFromXlsxRange(
  sheet: XlsxSheet,
  columnCount: number,
  range: NormalizedCellRange,
  showFormulas = false,
) {
  return sheet.rows.slice(range.top, range.bottom + 1).map((row, rowOffset) =>
    normalizeXlsxCells(
      row.cells,
      columnCount,
      row.index || String(range.top + rowOffset + 1),
    )
      .slice(range.left, range.right + 1)
      .map((cell) => displayXlsxCellValue(cell, showFormulas)),
  );
}

export function ensureXlsxRows(
  sheet: XlsxSheet,
  requiredRows: number,
  requiredColumns: number,
): XlsxRow[] {
  return Array.from({ length: Math.max(sheet.rows.length, requiredRows) }, (_, rowIndex) => {
    const row = sheet.rows[rowIndex] ?? {
      index: String(rowIndex + 1),
      cells: [] satisfies XlsxCell[],
    };
    return {
      ...row,
      index: row.index || String(rowIndex + 1),
      cells: normalizeXlsxCells(
        row.cells,
        requiredColumns,
        row.index || String(rowIndex + 1),
      ),
    };
  });
}

export function ensureXlsxDisplayRows(sheet: XlsxSheet, rowCount: number): XlsxRow[] {
  return Array.from({ length: Math.max(sheet.rows.length, rowCount) }, (_, rowIndex) => {
    const row = sheet.rows[rowIndex];
    if (row) return row;
    return {
      index: String(rowIndex + 1),
      cells: [] satisfies XlsxCell[],
    };
  });
}

export function xlsxDisplayRowCount(sheet: XlsxSheet) {
  const mergedRows = (sheet.mergedRanges ?? [])
    .map((range) => xlsxRangeFromRef(range.ref)?.bottom ?? 0)
    .map((index) => index + 1);
  const conditionalRows = (sheet.conditionalFormattings ?? [])
    .flatMap((formatting) => xlsxSqrefRanges(formatting.sqref))
    .map((range) => range.bottom + 1);
  const validationRows = (sheet.dataValidations ?? [])
    .flatMap((validation) => xlsxSqrefRanges(validation.sqref))
    .map((range) => range.bottom + 1);
  const hyperlinkRows = (sheet.hyperlinks ?? [])
    .flatMap((hyperlink) => xlsxSqrefRanges(hyperlink.ref))
    .map((range) => range.bottom + 1);
  const commentRows = (sheet.comments ?? [])
    .flatMap((comment) => xlsxSqrefRanges(comment.ref))
    .map((range) => range.bottom + 1);
  return Math.max(
    MIN_XLSX_VISIBLE_ROWS,
    sheet.rows.length,
    ...mergedRows,
    ...conditionalRows,
    ...validationRows,
    ...hyperlinkRows,
    ...commentRows,
  );
}

export function xlsxColumnCount(sheet: XlsxSheet) {
  const rowColumns = sheet.rows.map((row) => row.cells.length);
  const metadataColumns = (sheet.columns ?? []).map((column) => column.index + 1);
  const mergedColumns = (sheet.mergedRanges ?? [])
    .map((range) => xlsxRangeFromRef(range.ref)?.right ?? 0)
    .map((index) => index + 1);
  const conditionalColumns = (sheet.conditionalFormattings ?? [])
    .flatMap((formatting) => xlsxSqrefRanges(formatting.sqref))
    .map((range) => range.right + 1);
  const hyperlinkColumns = (sheet.hyperlinks ?? [])
    .flatMap((hyperlink) => xlsxSqrefRanges(hyperlink.ref))
    .map((range) => range.right + 1);
  const commentColumns = (sheet.comments ?? [])
    .flatMap((comment) => xlsxSqrefRanges(comment.ref))
    .map((range) => range.right + 1);
  return Math.max(
    MIN_XLSX_VISIBLE_COLUMNS,
    ...rowColumns,
    ...metadataColumns,
    ...mergedColumns,
    ...conditionalColumns,
    ...hyperlinkColumns,
    ...commentColumns,
  );
}

export function visibleXlsxColumns(sheet: XlsxSheet | undefined, columnCount: number) {
  return indexRange(0, columnCount).filter(
    (columnIndex) => !xlsxColumn(sheet, columnIndex)?.hidden,
  );
}

export function xlsxColumn(sheet: XlsxSheet | undefined, columnIndex: number) {
  return sheet?.columns?.find((column) => column.index === columnIndex);
}

export function xlsxColumnWidthPx(sheet: XlsxSheet | undefined, columnIndex: number) {
  const width = xlsxColumn(sheet, columnIndex)?.width ?? DEFAULT_XLSX_COLUMN_WIDTH;
  return Math.max(48, Math.round(width * 7 + 12));
}

export function xlsxRowHeightPx(row: XlsxRow) {
  return Math.max(24, Math.round((row.height ?? DEFAULT_XLSX_ROW_HEIGHT) * 4 / 3));
}

export function sumXlsxColumnWidths(sheet: XlsxSheet | undefined, columns: number[]) {
  return columns.reduce(
    (total, columnIndex) => total + xlsxColumnWidthPx(sheet, columnIndex),
    0,
  );
}

export function upsertXlsxColumn(
  columns: XlsxColumn[] | undefined,
  columnIndex: number,
  patch: Partial<XlsxColumn>,
): XlsxColumn[] {
  const existing = columns ?? [];
  const next = existing.some((column) => column.index === columnIndex)
    ? existing.map((column) =>
        column.index === columnIndex ? { ...column, ...patch } : column,
      )
    : [...existing, { index: columnIndex, ...patch }];
  return next
    .filter((column) =>
      column.hidden || column.width !== undefined,
    )
    .sort((left, right) => left.index - right.index);
}

export function shiftXlsxColumnsForInsert(
  columns: XlsxColumn[] | undefined,
  insertAt: number,
) {
  return (columns ?? []).map((column) => ({
    ...column,
    index: column.index >= insertAt ? column.index + 1 : column.index,
  }));
}

export function shiftXlsxColumnsForDelete(
  columns: XlsxColumn[] | undefined,
  deleteAt: number,
) {
  return (columns ?? [])
    .filter((column) => column.index !== deleteAt)
    .map((column) => ({
      ...column,
      index: column.index > deleteAt ? column.index - 1 : column.index,
    }));
}

export function insertXlsxCell(cells: XlsxCell[], insertAt: number, rowIndex: string) {
  const next = [...cells];
  next.splice(insertAt, 0, {
    ref: `${columnName(insertAt)}${rowIndex}`,
    value: "",
  });
  return next.map((cell, cellIndex) => ({
    ...cell,
    ref: `${columnName(cellIndex)}${rowIndex}`,
  }));
}

export function reindexXlsxRows(rows: XlsxRow[], columnCount: number) {
  return rows.map((row, rowIndex) => {
    const nextRowIndex = String(rowIndex + 1);
    return {
      ...row,
      index: nextRowIndex,
      cells: normalizeXlsxCells(row.cells, columnCount, nextRowIndex).map(
        (cell, cellIndex) => ({
          ...cell,
          ref: `${columnName(cellIndex)}${nextRowIndex}`,
        }),
      ),
    };
  });
}

export function filteredXlsxRows(
  rows: XlsxRow[],
  columnCount: number,
  filterText: string,
) {
  const query = filterText.trim().toLowerCase();
  return rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row, rowIndex }) => {
      if (row.hidden) return false;
      if (!query) return true;
      return normalizeXlsxCells(
        row.cells,
        columnCount,
        row.index || String(rowIndex + 1),
      ).some((cell) => displayXlsxCellValue(cell).toLowerCase().includes(query));
    });
}

export function sortXlsxRange(
  rows: XlsxRow[],
  range: NormalizedCellRange,
  columnIndex: number,
  direction: "asc" | "desc",
) {
  const normalizedRows = rows.map((row, rowIndex) => ({
    ...row,
    cells: normalizeXlsxCells(
      row.cells,
      range.right + 1,
      row.index || String(rowIndex + 1),
    ),
  }));
  const sortedSegments = normalizedRows
    .slice(range.top, range.bottom + 1)
    .map((row, originalIndex) => ({
      cells: row.cells.slice(range.left, range.right + 1),
      originalIndex,
    }))
    .sort((left, right) => {
      const result = compareSpreadsheetValues(
        displayXlsxCellValue(left.cells[columnIndex - range.left]),
        displayXlsxCellValue(right.cells[columnIndex - range.left]),
      );
      if (result !== 0) return direction === "asc" ? result : -result;
      return left.originalIndex - right.originalIndex;
    });
  return normalizedRows.map((row, rowIndex) => {
    if (rowIndex < range.top || rowIndex > range.bottom) return row;
    const segment = sortedSegments[rowIndex - range.top]?.cells ?? [];
    const cells = [...row.cells];
    for (let column = range.left; column <= range.right; column += 1) {
      const source = segment[column - range.left];
      cells[column] = {
        ...(source ?? { value: "" }),
        ref: `${columnName(column)}${rowIndex + 1}`,
      };
    }
    return { ...row, cells };
  });
}

/**
 * Sorting is enabled only for a selected raw-value rectangle whose related
 * metadata has unambiguous ownership. Unsupported combinations are surfaced
 * as a reason in the toolbar instead of committing a plausible-looking sort
 * that bakes formula results or detaches comments and range rules.
 */
export function xlsxSortBlockReason(
  sheet: XlsxSheet | undefined,
  range: NormalizedCellRange | null,
  columnIndex: number | undefined,
  filterText = "",
) {
  if (!sheet || !range || columnIndex === undefined) {
    return "Select a rectangular range before sorting";
  }
  if (range.bottom <= range.top) return "Select at least two rows to sort";
  if (columnIndex < range.left || columnIndex > range.right) {
    return "Keep the active sort cell inside the selected range";
  }
  if (range.top < 0 || range.bottom >= sheet.rows.length) {
    return "The sort range must contain existing rows only";
  }
  if (filterText.trim()) return "Clear the view-only row filter before sorting";
  if (sheet.protection?.enabled) return "Protected sheets cannot be sorted here";
  if (sheet.autoFilter) return "Clear the saved filter before sorting this range";
  if ((sheet.pivots?.length ?? 0) > 0) {
    return "Pivot source ownership is unknown, so sorting is blocked";
  }
  if (
    sheet.rows
      .slice(range.top, range.bottom + 1)
      .some((row) => row.hidden)
  ) {
    return "Unhide every row in the selected range before sorting";
  }
  const selectedCells = sheet.rows
    .slice(range.top, range.bottom + 1)
    .flatMap((row, rowOffset) =>
      normalizeXlsxCells(
        row.cells,
        range.right + 1,
        row.index || String(range.top + rowOffset + 1),
      ).slice(range.left, range.right + 1),
    );
  if (
    selectedCells.some(
      (cell) =>
        cell.formula ||
        cell.formulaRef ||
        cell.formulaType ||
        cell.generated === "spill" ||
        cell.spillParent ||
        cell.spillRange,
    )
  ) {
    return "Formula and spill cells require a reference-aware sort";
  }
  if (sheet.mergedRanges?.some((item) => referenceOverlapsRange(item.ref, range))) {
    return "Merged cells overlap the selected sort range";
  }
  if (sheet.tables?.some((item) => referenceOverlapsRange(item.ref, range))) {
    return "Use a table-aware sort for ranges inside a table";
  }
  if (
    sheet.dataValidations?.some((item) => referenceOverlapsRange(item.sqref, range)) ||
    sheet.conditionalFormattings?.some((item) =>
      referenceOverlapsRange(item.sqref, range),
    ) ||
    sheet.hyperlinks?.some((item) => referenceOverlapsRange(item.ref, range)) ||
    sheet.comments?.some((item) => referenceOverlapsRange(item.ref, range))
  ) {
    return "Range metadata overlaps the selection and cannot be reordered safely";
  }
  return null;
}

function referenceOverlapsRange(
  reference: string | undefined,
  range: NormalizedCellRange,
) {
  return Boolean(
    reference &&
      xlsxSqrefRanges(reference).some((item) => rangesOverlap(item, range)),
  );
}

export function displayXlsxCellValue(cell?: XlsxCell, showFormulas = false) {
  if (!cell) return "";
  return cell.formula && showFormulas ? `=${cell.formula}` : cell.value;
}

export function formulaBarXlsxCellValue(cell?: XlsxCell) {
  if (!cell) return "";
  return cell.formula ? `=${cell.formula}` : cell.value;
}

export function xlsxCellFromInput(input: string) {
  if (input.startsWith("=")) {
    return {
      value: "",
      formula: input.slice(1),
      formulaType: undefined,
      formulaRef: undefined,
      formulaSharedIndex: undefined,
      generated: undefined,
      spillParent: undefined,
      spillRange: undefined,
    };
  }
  return {
    value: input,
    formula: undefined,
    formulaType: undefined,
    formulaRef: undefined,
    formulaSharedIndex: undefined,
    generated: undefined,
    spillParent: undefined,
    spillRange: undefined,
  };
}

export function xlsxFillInputFromCell(
  cell: XlsxCell | undefined,
  rowOffset: number,
  columnOffset: number,
) {
  if (!cell) return "";
  if (cell.formula) {
    return `=${adjustSpreadsheetFormulaReferences(cell.formula, rowOffset, columnOffset)}`;
  }
  return cell.value;
}

export function nextXlsxSheetPath(model: XlsxModel) {
  const used = new Set(model.sheets.map((sheet) => sheet.id));
  const numbers = model.sheets
    .map((sheet) => /xl\/worksheets\/sheet(\d+)\.xml$/i.exec(sheet.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value));
  let number = Math.max(0, ...numbers) + 1;
  while (used.has(`xl/worksheets/sheet${number}.xml`)) number += 1;
  return `xl/worksheets/sheet${number}.xml`;
}
