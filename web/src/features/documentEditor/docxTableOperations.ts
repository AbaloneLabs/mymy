import type { DocxBlock } from "./models";
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
  "rows" | "tableColumnWidths" | "tableRowHeights"
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
  return { rows: normalizedRows, tableRowHeights: heights };
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
  return {
    rows: rows.map((row) => {
      const cells = normalizeDocxTableRow(row, columns);
      cells.splice(insertAt, 0, "");
      return cells;
    }),
    tableColumnWidths: widths,
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
  return { rows: normalizedRows, tableRowHeights: heights };
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
  return {
    rows: rows.map((row) => {
      const cells = normalizeDocxTableRow(row, columns);
      cells.splice(columnIndex + 1, 0, cells[columnIndex] ?? "");
      return cells;
    }),
    tableColumnWidths: widths,
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
  return { rows: normalizedRows, tableRowHeights: heights };
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
  };
}

export function deleteDocxTableRow(
  block: DocxBlock,
  rowIndex: number,
): DocxTablePatch | null {
  const rows = tableRows(block);
  if (rows.length <= 1) return null;
  return {
    rows: rows.filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
    tableRowHeights: normalizeDocxTableRowHeights(
      block.tableRowHeights,
      rows.length,
    ).filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
  };
}

export function deleteDocxTableColumn(
  block: DocxBlock,
  columnIndex: number,
): DocxTablePatch | null {
  const rows = tableRows(block);
  const columns = tableColumnCount(rows);
  if (columns <= 1) return null;
  return {
    rows: rows.map((row) =>
      normalizeDocxTableRow(row, columns).filter(
        (_, currentColumnIndex) => currentColumnIndex !== columnIndex,
      ),
    ),
    tableColumnWidths: normalizeDocxTableColumnWidths(
      block.tableColumnWidths,
      columns,
    ).filter((_, currentColumnIndex) => currentColumnIndex !== columnIndex),
  };
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
