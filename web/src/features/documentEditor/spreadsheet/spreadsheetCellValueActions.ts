import {
  normalizeXlsxStylePatch,
  stripXlsxCellStyle,
} from "./spreadsheetPresentation";
import type { XlsxCellStylePatch } from "./spreadsheetPresentation";
import { buildXlsxAutofillMatrix } from "./spreadsheetSeriesFill";
import { spreadsheetFillTargetRange } from "./spreadsheetEditorUtils";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";
import {
  ensureXlsxRows,
  xlsxCellFromInput,
  xlsxFillInputFromCell,
} from "./spreadsheetXlsxGridModel";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type { XlsxCell } from "../shared/models";
import type { SpreadsheetCellActionParams } from "./spreadsheetCellActionTypes";
import { validateXlsxCellInput } from "./spreadsheetValidation";

export function createSpreadsheetCellValueActions({
  activeCell,
  columnCount,
  commitXlsxModel,
  model,
  onMutationError,
  selectedRanges,
  selectionRange,
  setActiveCell,
  setSelectionAnchor,
  setSelectionEnd,
  sheet,
}: SpreadsheetCellActionParams) {
  function updateCell(rowIndex: number, cellIndex: number, value: string) {
    if (!sheet) return;
    const validation = validateXlsxCellInput(
      model,
      sheet,
      rowIndex,
      cellIndex,
      value,
    );
    if (!validation.valid) {
      onMutationError?.(`${cellReference(rowIndex, cellIndex)}: ${validation.reason}`);
      return;
    }
    onMutationError?.(null);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                rowIndex + 1,
                Math.max(columnCount, cellIndex + 1),
              ).map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(currentRowIndex + 1),
                      ).map((cell, currentCellIndex) =>
                        currentCellIndex === cellIndex
                          ? xlsxCellFromInputWithPreservedFormulaMetadata(cell, value)
                          : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function updateCellFormulaMetadata(
    rowIndex: number,
    cellIndex: number,
    patch: Pick<XlsxCell, "formulaType" | "formulaRef" | "formulaSharedIndex">,
  ) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                rowIndex + 1,
                Math.max(columnCount, cellIndex + 1),
              ).map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(currentRowIndex + 1),
                      ).map((cell, currentCellIndex) =>
                        currentCellIndex === cellIndex
                          ? { ...cell, ...patch }
                          : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function updateCellsFromMatrix(
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    if (!sheet || matrix.length === 0) return;
    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
      const values = matrix[rowOffset] ?? [];
      for (let columnOffset = 0; columnOffset < values.length; columnOffset += 1) {
        const rowIndex = startRow + rowOffset;
        const cellIndex = startColumn + columnOffset;
        const validation = validateXlsxCellInput(
          model,
          sheet,
          rowIndex,
          cellIndex,
          values[columnOffset] ?? "",
        );
        if (!validation.valid) {
          onMutationError?.(
            `${cellReference(rowIndex, cellIndex)}: ${validation.reason}`,
          );
          return;
        }
      }
    }
    onMutationError?.(null);
    const requiredRows = startRow + matrix.length;
    const requiredColumns = Math.max(
      columnCount,
      startColumn + Math.max(...matrix.map((row) => row.length)),
    );
    const rows = ensureXlsxRows(sheet, requiredRows, requiredColumns).map(
      (row, rowIndex) => ({
        ...row,
        cells: normalizeXlsxCells(
          row.cells,
          requiredColumns,
          row.index || String(rowIndex + 1),
        ).map((cell, cellIndex) => {
          const pastedRow = matrix[rowIndex - startRow];
          if (!pastedRow || cellIndex < startColumn) return cell;
          const pastedValue = pastedRow[cellIndex - startColumn];
          return pastedValue === undefined
            ? cell
            : { ...cell, ...xlsxCellFromInput(pastedValue) };
        }),
      }),
    );
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, rows } : item,
      ),
    });
  }

  function fillDown() {
    if (!sheet || !selectionRange || selectionRange.bottom <= selectionRange.top) return;
    const sourceRow = sheet.rows[selectionRange.top];
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) =>
        Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) => {
            const sourceCell =
              sourceRow?.cells[selectionRange.left + columnOffset];
            return xlsxFillInputFromCell(sourceCell, rowOffset, 0);
          },
        ),
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function fillRight() {
    if (!sheet || !selectionRange || selectionRange.right <= selectionRange.left) return;
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) => {
        const row = sheet.rows[selectionRange.top + rowOffset];
        const source = row?.cells[selectionRange.left];
        return Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) => xlsxFillInputFromCell(source, 0, columnOffset),
        );
      },
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function applyFillDrag(drag: {
    source: NormalizedCellRange;
    end: CellPosition;
  }) {
    if (!sheet) return;
    const target = spreadsheetFillTargetRange(drag.source, drag.end);
    if (
      target.top === drag.source.top &&
      target.right === drag.source.right &&
      target.bottom === drag.source.bottom &&
      target.left === drag.source.left
    ) {
      return;
    }
    const matrix = buildXlsxAutofillMatrix({
      sheet,
      columnCount,
      source: drag.source,
      target,
    });
    updateCellsFromMatrix(target.top, target.left, matrix);
    setActiveCell({ row: target.bottom, column: target.right });
    setSelectionAnchor({ row: target.top, column: target.left });
    setSelectionEnd({ row: target.bottom, column: target.right });
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.row, activeCell.column, "");
  }

  function updateSelectedCells(
    updater: (cell: XlsxCell, rowIndex: number, cellIndex: number) => XlsxCell,
  ) {
    if (!sheet) return;
    if (selectedRanges.length === 0) return;
    const bottom = Math.max(...selectedRanges.map((range) => range.bottom));
    const right = Math.max(...selectedRanges.map((range) => range.right));
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                bottom + 1,
                Math.max(columnCount, right + 1),
              ).map((row, rowIndex) =>
                selectedRanges.some(
                  (range) => rowIndex >= range.top && rowIndex <= range.bottom,
                )
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(rowIndex + 1),
                      ).map((cell, cellIndex) =>
                        selectedRanges.some(
                          (range) =>
                            rowIndex >= range.top &&
                            rowIndex <= range.bottom &&
                            cellIndex >= range.left &&
                            cellIndex <= range.right,
                        )
                          ? updater(cell, rowIndex, cellIndex)
                          : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function applyCellStyle(patch: XlsxCellStylePatch) {
    updateSelectedCells((cell) => ({
      ...cell,
      ...normalizeXlsxStylePatch(patch),
    }));
  }

  function clearSelectedCellFormat() {
    updateSelectedCells(stripXlsxCellStyle);
  }

  return {
    applyCellStyle,
    applyFillDrag,
    clearActiveCell,
    clearSelectedCellFormat,
    fillDown,
    fillRight,
    updateCell,
    updateCellFormulaMetadata,
    updateCellsFromMatrix,
  };
}

function cellReference(rowIndex: number, cellIndex: number) {
  return `${columnName(cellIndex)}${rowIndex + 1}`;
}

function xlsxCellFromInputWithPreservedFormulaMetadata(
  cell: XlsxCell,
  input: string,
): XlsxCell {
  const next = xlsxCellFromInput(input);
  if (next.formula === undefined) return { ...cell, ...next };
  return {
    ...cell,
    ...next,
    formulaType: cell.formulaType,
    formulaRef: cell.formulaRef,
    formulaSharedIndex: cell.formulaSharedIndex,
  };
}
