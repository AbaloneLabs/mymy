import {
  shiftXlsxDefinedNamesForColumnDelete,
  shiftXlsxDefinedNamesForColumnInsert,
  shiftXlsxDefinedNamesForRowDelete,
  shiftXlsxDefinedNamesForRowInsert,
} from "./spreadsheetDefinedNames";
import { shiftXlsxTables } from "./spreadsheetEditorUtils";
import { clampNumber } from "./spreadsheetGeometry";
import {
  shiftXlsxCommentsForColumnDelete,
  shiftXlsxCommentsForColumnInsert,
  shiftXlsxCommentsForRowDelete,
  shiftXlsxCommentsForRowInsert,
  shiftXlsxConditionalFormattingsForColumnDelete,
  shiftXlsxConditionalFormattingsForColumnInsert,
  shiftXlsxConditionalFormattingsForRowDelete,
  shiftXlsxConditionalFormattingsForRowInsert,
  shiftXlsxDataValidationsForColumnDelete,
  shiftXlsxDataValidationsForColumnInsert,
  shiftXlsxDataValidationsForRowDelete,
  shiftXlsxDataValidationsForRowInsert,
  shiftXlsxHyperlinksForColumnDelete,
  shiftXlsxHyperlinksForColumnInsert,
  shiftXlsxHyperlinksForRowDelete,
  shiftXlsxHyperlinksForRowInsert,
  shiftXlsxRangeForColumnDelete,
  shiftXlsxRangeForColumnInsert,
  shiftXlsxRangeForRowDelete,
  shiftXlsxRangeForRowInsert,
} from "./spreadsheetXlsxMetadata";
import {
  ensureXlsxRows,
  insertXlsxCell,
  reindexXlsxRows,
  shiftXlsxColumnsForDelete,
  shiftXlsxColumnsForInsert,
  sortXlsxRows,
  upsertXlsxColumn,
} from "./spreadsheetXlsxGridModel";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type { SpreadsheetCellActionParams } from "./spreadsheetCellActionTypes";

export function createSpreadsheetSheetStructureActions({
  activeCell,
  columnCount,
  commitXlsxModel,
  displaySheet,
  model,
  setActiveCell,
  setExtraSelectionRanges,
  setSelectionAnchor,
  setSelectionEnd,
  sheet,
}: SpreadsheetCellActionParams) {
  function addRow() {
    if (!sheet) return;
    const insertAt = activeCell ? activeCell.row + 1 : sheet.rows.length;
    const nextRows = ensureXlsxRows(sheet, insertAt, columnCount).map((row, rowIndex) => ({
      ...row,
      cells: normalizeXlsxCells(
        row.cells,
        columnCount,
        row.index || String(rowIndex + 1),
      ),
    }));
    nextRows.splice(insertAt, 0, {
      index: String(insertAt + 1),
      cells: Array.from({ length: columnCount }, (_, index) => ({
        ref: `${columnName(index)}${insertAt + 1}`,
        value: "",
      })),
    });
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: reindexXlsxRows(nextRows, columnCount),
              dataValidations: shiftXlsxDataValidationsForRowInsert(
                item.dataValidations,
                insertAt,
              ),
              conditionalFormattings: shiftXlsxConditionalFormattingsForRowInsert(
                item.conditionalFormattings,
                insertAt,
              ),
              hyperlinks: shiftXlsxHyperlinksForRowInsert(
                item.hyperlinks,
                insertAt,
              ),
              comments: shiftXlsxCommentsForRowInsert(
                item.comments,
                insertAt,
              ),
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForRowInsert(reference, insertAt),
              ),
              autoFilter: shiftXlsxRangeForRowInsert(item.autoFilter, insertAt),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForRowInsert(
        model.definedNames,
        model.sheets,
        sheet.id,
        insertAt,
      ),
    });
    setActiveCell({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionAnchor({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionEnd({ row: insertAt, column: activeCell?.column ?? 0 });
  }

  function addColumn() {
    if (!sheet) return;
    const insertAt = activeCell ? activeCell.column + 1 : columnCount;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: shiftXlsxColumnsForInsert(item.columns, insertAt),
              dataValidations: shiftXlsxDataValidationsForColumnInsert(
                item.dataValidations,
                insertAt,
              ),
              conditionalFormattings:
                shiftXlsxConditionalFormattingsForColumnInsert(
                  item.conditionalFormattings,
                  insertAt,
                ),
              hyperlinks: shiftXlsxHyperlinksForColumnInsert(
                item.hyperlinks,
                insertAt,
              ),
              comments: shiftXlsxCommentsForColumnInsert(
                item.comments,
                insertAt,
              ),
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForColumnInsert(reference, insertAt),
              ),
              autoFilter: shiftXlsxRangeForColumnInsert(item.autoFilter, insertAt),
              rows: item.rows.map((row, rowIndex) => ({
                ...row,
                cells: insertXlsxCell(
                  normalizeXlsxCells(
                    row.cells,
                    columnCount,
                    row.index || String(rowIndex + 1),
                  ),
                  insertAt,
                  row.index || String(rowIndex + 1),
                ),
              })),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForColumnInsert(
        model.definedNames,
        model.sheets,
        sheet.id,
        insertAt,
      ),
    });
    setActiveCell({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionAnchor({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionEnd({ row: activeCell?.row ?? 0, column: insertAt });
  }

  function sortRowsByActiveColumn(direction: "asc" | "desc") {
    if (!sheet || !activeCell) return;
    const sorted = sortXlsxRows(
      displaySheet?.rows ?? sheet.rows,
      columnCount,
      activeCell.column,
      direction,
    );
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, rows: sorted } : item,
      ),
    });
  }

  function deleteActiveRow() {
    if (
      !sheet ||
      !activeCell ||
      activeCell.row >= sheet.rows.length ||
      sheet.rows.length <= 1
    ) {
      return;
    }
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows
                .filter((_, index) => index !== activeCell.row)
                .map((row, index) => ({
                  ...row,
                  index: String(index + 1),
                  cells: row.cells.map((cell, cellIndex) => ({
                    ...cell,
                    ref: `${columnName(cellIndex)}${index + 1}`,
                  })),
                })),
              dataValidations: shiftXlsxDataValidationsForRowDelete(
                item.dataValidations,
                activeCell.row,
              ),
              conditionalFormattings: shiftXlsxConditionalFormattingsForRowDelete(
                item.conditionalFormattings,
                activeCell.row,
              ),
              hyperlinks: shiftXlsxHyperlinksForRowDelete(
                item.hyperlinks,
                activeCell.row,
              ),
              comments: shiftXlsxCommentsForRowDelete(
                item.comments,
                activeCell.row,
              ),
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForRowDelete(reference, activeCell.row),
              ),
              autoFilter: shiftXlsxRangeForRowDelete(
                item.autoFilter,
                activeCell.row,
              ),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForRowDelete(
        model.definedNames,
        model.sheets,
        sheet.id,
        activeCell.row,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setExtraSelectionRanges([]);
  }

  function deleteActiveColumn() {
    if (!sheet || !activeCell || columnCount <= 1) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) => ({
                ...row,
                cells: normalizeXlsxCells(
                  row.cells,
                  columnCount,
                  row.index || String(rowIndex + 1),
                )
                  .filter((_, index) => index !== activeCell.column)
                  .map((cell, cellIndex) => ({
                    ...cell,
                    ref: `${columnName(cellIndex)}${row.index || rowIndex + 1}`,
                  })),
              })),
              columns: shiftXlsxColumnsForDelete(item.columns, activeCell.column),
              dataValidations: shiftXlsxDataValidationsForColumnDelete(
                item.dataValidations,
                activeCell.column,
              ),
              conditionalFormattings:
                shiftXlsxConditionalFormattingsForColumnDelete(
                  item.conditionalFormattings,
                  activeCell.column,
                ),
              hyperlinks: shiftXlsxHyperlinksForColumnDelete(
                item.hyperlinks,
                activeCell.column,
              ),
              comments: shiftXlsxCommentsForColumnDelete(
                item.comments,
                activeCell.column,
              ),
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForColumnDelete(reference, activeCell.column),
              ),
              autoFilter: shiftXlsxRangeForColumnDelete(
                item.autoFilter,
                activeCell.column,
              ),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForColumnDelete(
        model.definedNames,
        model.sheets,
        sheet.id,
        activeCell.column,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setExtraSelectionRanges([]);
  }

  function updateColumnWidth(columnIndex: number, width: number) {
    if (!sheet || !Number.isFinite(width)) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: upsertXlsxColumn(item.columns, columnIndex, {
                width: clampNumber(width, 4, 80),
              }),
            }
          : item,
      ),
    });
  }

  function updateActiveColumnWidth(width: number) {
    if (!sheet || !activeCell || !Number.isFinite(width)) return;
    updateColumnWidth(activeCell.column, width);
  }

  function updateRowHeight(targetRowIndex: number, height: number) {
    if (!sheet || !Number.isFinite(height)) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) =>
                rowIndex === targetRowIndex
                  ? { ...row, height: clampNumber(height, 8, 180) }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function updateActiveRowHeight(height: number) {
    if (!sheet || !activeCell || !Number.isFinite(height)) return;
    updateRowHeight(activeCell.row, height);
  }

  return {
    addColumn,
    addRow,
    deleteActiveColumn,
    deleteActiveRow,
    sortRowsByActiveColumn,
    updateActiveColumnWidth,
    updateActiveRowHeight,
    updateColumnWidth,
    updateRowHeight,
  };
}
