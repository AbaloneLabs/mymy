import type { PptxSlide, PptxTable, PptxTableCellStyle } from "../shared/models";
import { insertPptxDimensionValue } from "./pptxEditorGeometry";

/**
 * PPTX table editing is separated from the slide editor so row, column, and
 * cell-style mutations stay localized. The slide editor owns selection and
 * layout state, while this module owns the table-shape invariants that must be
 * preserved across every table operation.
 */
export function createPptxTableEditors({
  slide,
  updateSlideTables,
}: {
  slide: PptxSlide | undefined;
  updateSlideTables: (
    slideId: string,
    updater: (tables: PptxTable[]) => PptxTable[],
  ) => void;
}) {
  function updateTableById(tableId: string, patch: Partial<PptxTable>) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId && !table.preservationOnly
          ? { ...table, ...patch }
          : table,
      ),
    );
  }

  function updateTableCell(
    tableId: string,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        return {
          ...table,
          rows: table.rows.map((row, currentRowIndex) =>
            currentRowIndex === rowIndex
              ? row.map((cell, currentColumnIndex) =>
                  currentColumnIndex === columnIndex ? value : cell,
                )
              : row,
          ),
        };
      }),
    );
  }

  function updateTableCellStyle(
    tableId: string,
    rowIndex: number,
    columnIndex: number,
    patch: Partial<PptxTableCellStyle>,
  ) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        const columnCount = Math.max(1, ...table.rows.map((row) => row.length));
        const cellStyles = Array.from({ length: table.rows.length }, (_, currentRow) =>
          Array.from({ length: columnCount }, (_cell, currentColumn) => ({
            ...(table.cellStyles?.[currentRow]?.[currentColumn] ?? {}),
          })),
        );
        cellStyles[rowIndex][columnIndex] = {
          ...cellStyles[rowIndex][columnIndex],
          ...patch,
        };
        return { ...table, cellStyles };
      }),
    );
  }

  function addTableRow(tableId: string, afterRowIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        const columnCount = Math.max(
          1,
          ...table.rows.map((row) => row.length),
        );
        const nextRows = table.rows.map((row) => [...row]);
        nextRows.splice(afterRowIndex + 1, 0, Array(columnCount).fill(""));
        const cellStyles = table.cellStyles
          ? table.cellStyles.map((row) => row.map((cell) => ({ ...cell })))
          : Array.from({ length: table.rows.length }, () =>
              Array.from({ length: columnCount }, () => ({})),
            );
        cellStyles.splice(
          afterRowIndex + 1,
          0,
          Array.from({ length: columnCount }, () => ({})),
        );
        const rowHeights = table.rowHeights
          ? [...table.rowHeights]
          : Array.from(
              { length: table.rows.length },
              () => 100 / Math.max(table.rows.length, 1),
            );
        rowHeights.splice(
          afterRowIndex + 1,
          0,
          rowHeights[afterRowIndex] ?? 100 / Math.max(nextRows.length, 1),
        );
        return { ...table, rows: nextRows, cellStyles, rowHeights };
      }),
    );
  }

  function addTableColumn(tableId: string, afterColumnIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId && !table.preservationOnly
          ? {
              ...table,
              rows: table.rows.map((row) => {
                const nextRow = [...row];
                nextRow.splice(afterColumnIndex + 1, 0, "");
                return nextRow;
              }),
              cellStyles: table.rows.map((row, rowIndex) => {
                const nextRow = Array.from(
                  { length: Math.max(1, row.length) },
                  (_cell, columnIndex) => ({
                    ...(table.cellStyles?.[rowIndex]?.[columnIndex] ?? {}),
                  }),
                );
                nextRow.splice(afterColumnIndex + 1, 0, {});
                return nextRow;
              }),
              columnWidths: insertPptxDimensionValue(
                table.columnWidths,
                Math.max(1, ...table.rows.map((row) => row.length)),
                afterColumnIndex,
              ),
            }
          : table,
      ),
    );
  }

  function deleteTableRow(tableId: string, rowIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) =>
        table.id === tableId && !table.preservationOnly && table.rows.length > 1
          ? {
              ...table,
              rows: table.rows.filter(
                (_row, currentRowIndex) => currentRowIndex !== rowIndex,
              ),
              rowHeights: table.rowHeights?.filter(
                (_height, currentRowIndex) => currentRowIndex !== rowIndex,
              ),
              cellStyles: table.cellStyles?.filter(
                (_row, currentRowIndex) => currentRowIndex !== rowIndex,
              ),
            }
          : table,
      ),
    );
  }

  function deleteTableColumn(tableId: string, columnIndex: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
        if (columnCount <= 1) return table;
        return {
          ...table,
          rows: table.rows.map((row) =>
            row.filter((_cell, currentColumnIndex) => currentColumnIndex !== columnIndex),
          ),
          columnWidths: table.columnWidths?.filter(
            (_width, currentColumnIndex) => currentColumnIndex !== columnIndex,
          ),
          cellStyles: table.cellStyles?.map((row) =>
            row.filter(
              (_style, currentColumnIndex) => currentColumnIndex !== columnIndex,
            ),
          ),
        };
      }),
    );
  }

  function updateTableColumnWidth(
    tableId: string,
    columnIndex: number,
    value: number,
  ) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        const columnCount = Math.max(1, ...table.rows.map((row) => row.length));
        const columnWidths =
          table.columnWidths && table.columnWidths.length === columnCount
            ? [...table.columnWidths]
            : Array.from({ length: columnCount }, () => 100 / columnCount);
        columnWidths[columnIndex] = Math.max(1, Math.min(100, value));
        return { ...table, columnWidths };
      }),
    );
  }

  function updateTableRowHeight(tableId: string, rowIndex: number, value: number) {
    if (!slide) return;
    updateSlideTables(slide.id, (tables) =>
      tables.map((table) => {
        if (table.id !== tableId || table.preservationOnly) return table;
        const rowCount = Math.max(1, table.rows.length);
        const rowHeights =
          table.rowHeights && table.rowHeights.length === rowCount
            ? [...table.rowHeights]
            : Array.from({ length: rowCount }, () => 100 / rowCount);
        rowHeights[rowIndex] = Math.max(1, Math.min(100, value));
        return { ...table, rowHeights };
      }),
    );
  }

  return {
    addTableColumn,
    addTableRow,
    deleteTableColumn,
    deleteTableRow,
    updateTableById,
    updateTableCell,
    updateTableCellStyle,
    updateTableColumnWidth,
    updateTableRowHeight,
  };
}
