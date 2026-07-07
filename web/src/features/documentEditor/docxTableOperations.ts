import type { DocxBlock, DocxTableMergedCell } from "./models";
import {
  DEFAULT_DOCX_TABLE_COLUMN_WIDTH,
  DEFAULT_DOCX_TABLE_ROW_HEIGHT,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRow,
  normalizeDocxTableRowHeights,
  tableColumnCount,
} from "./docxEditorUtils";

type DocxTablePatch = Pick<
  DocxBlock,
  "rows" | "tableColumnWidths" | "tableRowHeights" | "tableMergedCells"
>;

export function updateDocxTableCell(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
  value: string,
): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  return {
    rows: rows.map((row, currentRowIndex) =>
      currentRowIndex === rowIndex
        ? normalizeDocxTableRow(row, columns).map((cell, currentColumnIndex) =>
            currentColumnIndex === columnIndex ? value : cell,
          )
        : normalizeDocxTableRow(row, columns),
    ),
  };
}

export function addDocxTableRow(block: DocxBlock): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const heights = normalizeDocxTableRowHeights(block.tableRowHeights, rows.length);
  return {
    rows: [...rows.map((row) => normalizeDocxTableRow(row, columns)), Array(columns).fill("")],
    tableRowHeights: [
      ...heights,
      heights.at(-1) ?? DEFAULT_DOCX_TABLE_ROW_HEIGHT,
    ],
  };
}

export function insertDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
  position: "above" | "below",
): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
  const heights = normalizeDocxTableRowHeights(block.tableRowHeights, rows.length);
  const insertAt = position === "above" ? rowIndex : rowIndex + 1;
  normalizedRows.splice(insertAt, 0, Array(columns).fill(""));
  heights.splice(insertAt, 0, heights[rowIndex] ?? DEFAULT_DOCX_TABLE_ROW_HEIGHT);
  return {
    rows: normalizedRows,
    tableRowHeights: heights,
    tableMergedCells: insertMergedTableRow(block, insertAt, normalizedRows),
  };
}

export function addDocxTableColumn(block: DocxBlock): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const widths = normalizeDocxTableColumnWidths(block.tableColumnWidths, columns);
  return {
    rows: rows.map((row) => [...normalizeDocxTableRow(row, columns), ""]),
    tableColumnWidths: [
      ...widths,
      widths.at(-1) ?? DEFAULT_DOCX_TABLE_COLUMN_WIDTH,
    ],
  };
}

export function insertDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
  position: "left" | "right",
): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const insertAt = position === "left" ? columnIndex : columnIndex + 1;
  const widths = normalizeDocxTableColumnWidths(block.tableColumnWidths, columns);
  widths.splice(
    insertAt,
    0,
    widths[columnIndex] ?? DEFAULT_DOCX_TABLE_COLUMN_WIDTH,
  );
  const nextRows = rows.map((row) => {
    const cells = normalizeDocxTableRow(row, columns);
    cells.splice(insertAt, 0, "");
    return cells;
  });
  return {
    rows: nextRows,
    tableColumnWidths: widths,
    tableMergedCells: insertMergedTableColumn(block, insertAt, nextRows),
  };
}

export function duplicateDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
  const heights = normalizeDocxTableRowHeights(block.tableRowHeights, rows.length);
  normalizedRows.splice(rowIndex + 1, 0, [...normalizedRows[rowIndex]]);
  heights.splice(rowIndex + 1, 0, heights[rowIndex] ?? DEFAULT_DOCX_TABLE_ROW_HEIGHT);
  return {
    rows: normalizedRows,
    tableRowHeights: heights,
    tableMergedCells: insertMergedTableRow(block, rowIndex + 1, normalizedRows),
  };
}

export function duplicateDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
): DocxTablePatch {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const widths = normalizeDocxTableColumnWidths(block.tableColumnWidths, columns);
  widths.splice(
    columnIndex + 1,
    0,
    widths[columnIndex] ?? DEFAULT_DOCX_TABLE_COLUMN_WIDTH,
  );
  const nextRows = rows.map((row) => {
    const cells = normalizeDocxTableRow(row, columns);
    cells.splice(columnIndex + 1, 0, cells[columnIndex] ?? "");
    return cells;
  });
  return {
    rows: nextRows,
    tableColumnWidths: widths,
    tableMergedCells: insertMergedTableColumn(block, columnIndex + 1, nextRows),
  };
}

export function moveDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
  direction: -1 | 1,
): DocxTablePatch | null {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const nextIndex = rowIndex + direction;
  if (nextIndex < 0 || nextIndex >= rows.length) return null;
  const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
  const heights = normalizeDocxTableRowHeights(block.tableRowHeights, rows.length);
  const [moved] = normalizedRows.splice(rowIndex, 1);
  normalizedRows.splice(nextIndex, 0, moved);
  const [movedHeight] = heights.splice(rowIndex, 1);
  heights.splice(nextIndex, 0, movedHeight);
  return {
    rows: normalizedRows,
    tableRowHeights: heights,
    tableMergedCells: moveMergedTableRows(block, rowIndex, direction),
  };
}

export function moveDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
  direction: -1 | 1,
): DocxTablePatch | null {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  const nextIndex = columnIndex + direction;
  if (nextIndex < 0 || nextIndex >= columns) return null;
  const widths = normalizeDocxTableColumnWidths(block.tableColumnWidths, columns);
  const [movedWidth] = widths.splice(columnIndex, 1);
  widths.splice(nextIndex, 0, movedWidth);
  return {
    rows: rows.map((row) => {
      const cells = normalizeDocxTableRow(row, columns);
      const [moved] = cells.splice(columnIndex, 1);
      cells.splice(nextIndex, 0, moved);
      return cells;
    }),
    tableColumnWidths: widths,
    tableMergedCells: moveMergedTableColumns(block, columnIndex, direction),
  };
}

export function deleteDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
): DocxTablePatch | null {
  const rows = tableRows(block);
  if (rows.length <= 1) return null;
  const nextRows = rows.filter((_, currentRowIndex) => currentRowIndex !== rowIndex);
  return {
    rows: nextRows,
    tableRowHeights: normalizeDocxTableRowHeights(
      block.tableRowHeights,
      rows.length,
    ).filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
    tableMergedCells: deleteMergedTableRow(block, rowIndex, nextRows),
  };
}

export function deleteDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
): DocxTablePatch | null {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  if (columns <= 1) return null;
  const nextRows = rows.map((row) =>
    normalizeDocxTableRow(row, columns).filter(
      (_, currentColumnIndex) => currentColumnIndex !== columnIndex,
    ),
  );
  return {
    rows: nextRows,
    tableColumnWidths: normalizeDocxTableColumnWidths(
      block.tableColumnWidths,
      columns,
    ).filter((_, currentColumnIndex) => currentColumnIndex !== columnIndex),
    tableMergedCells: deleteMergedTableColumn(block, columnIndex, nextRows),
  };
}

export function mergeDocxTableCellRight(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
): Pick<DocxBlock, "tableMergedCells"> | null {
  const range = mergedRangeForCell(block, rowIndex, columnIndex) ?? {
    row: rowIndex,
    column: columnIndex,
    rowSpan: 1,
    colSpan: 1,
  };
  const columns = tableColumnCount(tableRows(block));
  const nextRange = { ...range, colSpan: range.colSpan + 1 };
  if (nextRange.column + nextRange.colSpan > columns) return null;
  return replaceMergedRange(block, range, nextRange);
}

export function mergeDocxTableCellDown(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
): Pick<DocxBlock, "tableMergedCells"> | null {
  const range = mergedRangeForCell(block, rowIndex, columnIndex) ?? {
    row: rowIndex,
    column: columnIndex,
    rowSpan: 1,
    colSpan: 1,
  };
  const rows = tableRows(block);
  const nextRange = { ...range, rowSpan: range.rowSpan + 1 };
  if (nextRange.row + nextRange.rowSpan > rows.length) return null;
  return replaceMergedRange(block, range, nextRange);
}

export function splitDocxTableCell(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
): Pick<DocxBlock, "tableMergedCells"> | null {
  const range = mergedRangeForCell(block, rowIndex, columnIndex);
  if (!range) return null;
  const next = normalizeDocxTableMergedCells(block).filter(
    (item) => !sameMergedRange(item, range),
  );
  return { tableMergedCells: next.length > 0 ? next : undefined };
}

export function pasteDocxTableCells(
  block: DocxBlock,
  startRow: number,
  startColumn: number,
  matrix: string[][],
): DocxTablePatch | null {
  const rows = tableRows(block);
  if (matrix.length === 0) return null;
  const currentColumns = tableColumnCount(rows);
  const requiredRows = Math.max(rows.length, startRow + matrix.length);
  const requiredColumns = Math.max(
    currentColumns,
    startColumn + Math.max(...matrix.map((row) => row.length)),
  );
  const nextRows = Array.from({ length: requiredRows }, (_, rowIndex) =>
    normalizeDocxTableRow(rows[rowIndex] ?? [], requiredColumns),
  );
  matrix.forEach((matrixRow, rowOffset) => {
    matrixRow.forEach((value, columnOffset) => {
      nextRows[startRow + rowOffset][startColumn + columnOffset] = value;
    });
  });
  return {
    rows: nextRows,
    tableColumnWidths: normalizeDocxTableColumnWidths(
      block.tableColumnWidths,
      requiredColumns,
    ),
    tableRowHeights: normalizeDocxTableRowHeights(
      block.tableRowHeights,
      requiredRows,
    ),
  };
}

export function resizeDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
  width: number,
): Pick<DocxBlock, "tableColumnWidths"> {
  const columns = tableColumnCount(tableRows(block));
  const widths = normalizeDocxTableColumnWidths(block.tableColumnWidths, columns);
  widths[columnIndex] = width;
  return { tableColumnWidths: widths };
}

export function resizeDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
  height: number,
): Pick<DocxBlock, "tableRowHeights"> {
  const rows = tableRows(block);
  const heights = normalizeDocxTableRowHeights(block.tableRowHeights, rows.length);
  heights[rowIndex] = height;
  return { tableRowHeights: heights };
}

function tableRows(block: DocxBlock) {
  return block.rows ?? [[""]];
}

export function normalizeDocxTableMergedCells(
  block: DocxBlock,
): DocxTableMergedCell[] {
  const rows = tableRows(block);
  const rowCount = rows.length;
  const columnCount = tableColumnCount(rows);
  const occupied = new Set<string>();
  const ranges: DocxTableMergedCell[] = [];
  for (const range of block.tableMergedCells ?? []) {
    const row = clampIndex(range.row, rowCount);
    const column = clampIndex(range.column, columnCount);
    const rowSpan = clampSpan(range.rowSpan, rowCount - row);
    const colSpan = clampSpan(range.colSpan, columnCount - column);
    if (rowSpan === 1 && colSpan === 1) continue;
    const next = { row, column, rowSpan, colSpan };
    const cells = mergedRangeCells(next);
    if (cells.some((cell) => occupied.has(cell))) continue;
    cells.forEach((cell) => occupied.add(cell));
    ranges.push(next);
  }
  return ranges;
}

export function mergedRangeForCell(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
) {
  return normalizeDocxTableMergedCells(block).find((range) =>
    mergedRangeContains(range, rowIndex, columnIndex),
  );
}

export function isDocxTableCellCovered(
  block: DocxBlock,
  rowIndex: number,
  columnIndex: number,
) {
  const range = mergedRangeForCell(block, rowIndex, columnIndex);
  return Boolean(range && (range.row !== rowIndex || range.column !== columnIndex));
}

function replaceMergedRange(
  block: DocxBlock,
  previous: DocxTableMergedCell,
  next: DocxTableMergedCell,
): Pick<DocxBlock, "tableMergedCells"> | null {
  const ranges = normalizeDocxTableMergedCells(block);
  const remaining = ranges.filter((range) => !sameMergedRange(range, previous));
  if (remaining.some((range) => mergedRangesOverlap(range, next))) return null;
  const mergedCells = normalizeMergedRanges(block, [...remaining, next]);
  return { tableMergedCells: mergedCells.length > 0 ? mergedCells : undefined };
}

function insertMergedTableRow(
  block: DocxBlock,
  insertAt: number,
  rows: string[][],
) {
  const ranges = normalizeDocxTableMergedCells(block).map((range) => {
    if (insertAt <= range.row) return { ...range, row: range.row + 1 };
    if (insertAt < range.row + range.rowSpan) {
      return { ...range, rowSpan: range.rowSpan + 1 };
    }
    return range;
  });
  return normalizeMergedRanges({ ...block, rows }, ranges);
}

function insertMergedTableColumn(
  block: DocxBlock,
  insertAt: number,
  rows: string[][],
) {
  const ranges = normalizeDocxTableMergedCells(block).map((range) => {
    if (insertAt <= range.column) return { ...range, column: range.column + 1 };
    if (insertAt < range.column + range.colSpan) {
      return { ...range, colSpan: range.colSpan + 1 };
    }
    return range;
  });
  return normalizeMergedRanges({ ...block, rows }, ranges);
}

function deleteMergedTableRow(
  block: DocxBlock,
  rowIndex: number,
  rows: string[][],
) {
  const ranges = normalizeDocxTableMergedCells(block)
    .map((range) => {
      if (rowIndex < range.row) return { ...range, row: range.row - 1 };
      if (rowIndex >= range.row && rowIndex < range.row + range.rowSpan) {
        return { ...range, rowSpan: range.rowSpan - 1 };
      }
      return range;
    })
    .filter((range) => range.rowSpan > 0);
  return normalizeMergedRanges({ ...block, rows }, ranges);
}

function deleteMergedTableColumn(
  block: DocxBlock,
  columnIndex: number,
  rows: string[][],
) {
  const ranges = normalizeDocxTableMergedCells(block)
    .map((range) => {
      if (columnIndex < range.column) {
        return { ...range, column: range.column - 1 };
      }
      if (columnIndex >= range.column && columnIndex < range.column + range.colSpan) {
        return { ...range, colSpan: range.colSpan - 1 };
      }
      return range;
    })
    .filter((range) => range.colSpan > 0);
  return normalizeMergedRanges({ ...block, rows }, ranges);
}

function moveMergedTableRows(
  block: DocxBlock,
  rowIndex: number,
  direction: -1 | 1,
) {
  const rowMap = movedIndexMap(tableRows(block).length, rowIndex, direction);
  return remapMergedRanges(block, rowMap, null);
}

function moveMergedTableColumns(
  block: DocxBlock,
  columnIndex: number,
  direction: -1 | 1,
) {
  const columnMap = movedIndexMap(
    tableColumnCount(tableRows(block)),
    columnIndex,
    direction,
  );
  return remapMergedRanges(block, null, columnMap);
}

function remapMergedRanges(
  block: DocxBlock,
  rowMap: Map<number, number> | null,
  columnMap: Map<number, number> | null,
) {
  const ranges = normalizeDocxTableMergedCells(block)
    .map((range) => {
      const rows = Array.from({ length: range.rowSpan }, (_, offset) =>
        rowMap?.get(range.row + offset) ?? range.row + offset,
      ).sort((left, right) => left - right);
      const columns = Array.from({ length: range.colSpan }, (_, offset) =>
        columnMap?.get(range.column + offset) ?? range.column + offset,
      ).sort((left, right) => left - right);
      if (!isContiguous(rows) || !isContiguous(columns)) return null;
      return {
        row: rows[0],
        column: columns[0],
        rowSpan: rows.length,
        colSpan: columns.length,
      };
    })
    .filter((range): range is DocxTableMergedCell => range !== null);
  return normalizeMergedRanges(block, ranges);
}

function movedIndexMap(length: number, index: number, direction: -1 | 1) {
  const target = index + direction;
  const indexes = Array.from({ length }, (_, item) => item);
  const [moved] = indexes.splice(index, 1);
  indexes.splice(target, 0, moved);
  return new Map(indexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
}

function normalizeMergedRanges(block: DocxBlock, ranges: DocxTableMergedCell[]) {
  return normalizeDocxTableMergedCells({ ...block, tableMergedCells: ranges });
}

function sameMergedRange(left: DocxTableMergedCell, right: DocxTableMergedCell) {
  return (
    left.row === right.row &&
    left.column === right.column &&
    left.rowSpan === right.rowSpan &&
    left.colSpan === right.colSpan
  );
}

function mergedRangesOverlap(left: DocxTableMergedCell, right: DocxTableMergedCell) {
  return mergedRangeCells(left).some((cell) => mergedRangeCells(right).includes(cell));
}

function mergedRangeContains(
  range: DocxTableMergedCell,
  rowIndex: number,
  columnIndex: number,
) {
  return (
    rowIndex >= range.row &&
    rowIndex < range.row + range.rowSpan &&
    columnIndex >= range.column &&
    columnIndex < range.column + range.colSpan
  );
}

function mergedRangeCells(range: DocxTableMergedCell) {
  return Array.from({ length: range.rowSpan }, (_, rowOffset) =>
    Array.from(
      { length: range.colSpan },
      (_, columnOffset) => `${range.row + rowOffset}:${range.column + columnOffset}`,
    ),
  ).flat();
}

function isContiguous(values: number[]) {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function clampIndex(value: number, length: number) {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value)));
}

function clampSpan(value: number, max: number) {
  return Math.min(Math.max(1, max), Math.max(1, Math.floor(value)));
}
