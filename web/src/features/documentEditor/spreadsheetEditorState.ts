import { xlsxDefinedNameValueForSheet } from "./spreadsheetDefinedNames";
import {
  DEFAULT_XLSX_COLUMN_WIDTH,
  DEFAULT_XLSX_ROW_HEIGHT,
  MIN_XLSX_VISIBLE_COLUMNS,
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  normalizeCellRange,
  virtualWindow,
} from "./spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "./spreadsheetGeometry";
import {
  summarizeSelection,
  xlsxCellStyleFromCell,
} from "./spreadsheetPresentation";
import { spreadsheetFillTargetRange, spreadsheetTableResizeTargetRange } from "./spreadsheetEditorUtils";
import {
  xlsxCommentForRange,
  xlsxConditionalRuleForRange,
  xlsxDataValidationForRange,
  xlsxHyperlinkForRange,
} from "./spreadsheetXlsxMetadata";
import {
  ensureXlsxDisplayRows,
  filteredXlsxRows,
  formulaBarXlsxCellValue,
  recalculateXlsxModel,
  recalculateXlsxSheet,
  sumXlsxColumnWidths,
  valuesFromXlsxRange,
  visibleXlsxColumns,
  xlsxColumn,
  xlsxColumnCount,
  xlsxDisplayRowCount,
} from "./spreadsheetXlsxModel";
import { columnName } from "./models";
import type { XlsxModel } from "./models";

export type SpreadsheetFillDrag = {
  source: NormalizedCellRange;
  end: CellPosition;
};

export type SpreadsheetTableResizeDrag = {
  tableId: string;
  source: NormalizedCellRange;
  end: CellPosition;
};

export function deriveSpreadsheetEditorState({
  model,
  preferredSheetId,
  activeCell,
  selectionAnchor,
  selectionEnd,
  extraSelectionRanges,
  fillDrag,
  tableResizeDrag,
  filterText,
  showFormulas,
  viewport,
}: {
  model: XlsxModel;
  preferredSheetId: string | null;
  activeCell: CellPosition | null;
  selectionAnchor: CellPosition | null;
  selectionEnd: CellPosition | null;
  extraSelectionRanges: NormalizedCellRange[];
  fillDrag: SpreadsheetFillDrag | null;
  tableResizeDrag: SpreadsheetTableResizeDrag | null;
  filterText: string;
  showFormulas: boolean;
  viewport: SpreadsheetViewport;
}) {
  const sheet =
    model.sheets.find((item) => item.id === preferredSheetId) ?? model.sheets[0];
  const columnCount = sheet ? xlsxColumnCount(sheet) : MIN_XLSX_VISIBLE_COLUMNS;
  const visibleColumns = visibleXlsxColumns(sheet, columnCount);
  const recalculatedModel = recalculateXlsxModel(model);
  const displaySheet = sheet
    ? recalculatedModel.sheets.find((item) => item.id === sheet.id) ??
      recalculateXlsxSheet(sheet, columnCount)
    : undefined;
  const displayRows = displaySheet
    ? ensureXlsxDisplayRows(displaySheet, xlsxDisplayRowCount(displaySheet))
    : [];
  const displayGridSheet = displaySheet ? { ...displaySheet, rows: displayRows } : undefined;
  const visibleRows = displayGridSheet
    ? filteredXlsxRows(displayGridSheet.rows, columnCount, filterText)
    : [];
  const displayRowLimit = displayGridSheet?.rows.length ?? 1;
  const rowWindow = virtualWindow(
    visibleRows.length,
    Math.max(0, viewport.scrollTop - SPREADSHEET_HEADER_HEIGHT),
    viewport.height,
    SPREADSHEET_ROW_HEIGHT,
    12,
  );
  const columnWindow = virtualWindow(
    visibleColumns.length,
    Math.max(0, viewport.scrollLeft - SPREADSHEET_ROW_HEADER_WIDTH),
    viewport.width,
    SPREADSHEET_COLUMN_WIDTH,
    4,
  );
  const visibleColumnIndexes = visibleColumns.slice(columnWindow.start, columnWindow.end);
  const leftColumnSpacerWidth = sumXlsxColumnWidths(
    sheet,
    visibleColumns.slice(0, columnWindow.start),
  );
  const rightColumnSpacerWidth = sumXlsxColumnWidths(
    sheet,
    visibleColumns.slice(columnWindow.end),
  );
  const selectionRange = normalizeCellRange(selectionAnchor, selectionEnd);
  const activeSingleCellRange = activeCell
    ? {
        top: activeCell.row,
        right: activeCell.column,
        bottom: activeCell.row,
        left: activeCell.column,
      }
    : null;
  const selectedRanges = [
    ...extraSelectionRanges,
    ...(selectionRange ? [selectionRange] : activeSingleCellRange ? [activeSingleCellRange] : []),
  ];
  const activeDefinedNameValue =
    sheet && selectionRange
      ? xlsxDefinedNameValueForSheet(sheet.name, selectionRange)
      : undefined;
  const fillPreviewRange = fillDrag
    ? spreadsheetFillTargetRange(fillDrag.source, fillDrag.end)
    : null;
  const tableResizePreviewRange = tableResizeDrag
    ? spreadsheetTableResizeTargetRange(tableResizeDrag.source, tableResizeDrag.end)
    : null;
  const validationRange =
    selectionRange ??
    (activeCell
      ? {
          top: activeCell.row,
          right: activeCell.column,
          bottom: activeCell.row,
          left: activeCell.column,
        }
      : null);
  const activeDataValidation =
    sheet && validationRange
      ? xlsxDataValidationForRange(sheet.dataValidations, validationRange)
      : undefined;
  const activeConditionalRule =
    sheet && validationRange
      ? xlsxConditionalRuleForRange(sheet.conditionalFormattings, validationRange)
      : undefined;
  const activeHyperlink =
    sheet && validationRange
      ? xlsxHyperlinkForRange(sheet.hyperlinks, validationRange)
      : undefined;
  const activeComment =
    sheet && validationRange
      ? xlsxCommentForRange(sheet.comments, validationRange)
      : undefined;
  const activeCellObject =
    activeCell && sheet?.rows[activeCell.row]?.cells[activeCell.column]
      ? sheet.rows[activeCell.row].cells[activeCell.column]
      : undefined;
  const activeCellValue = activeCellObject
    ? formulaBarXlsxCellValue(activeCellObject)
    : "";
  const activeCellReference = activeCell
    ? `${columnName(activeCell.column)}${activeCell.row + 1}`
    : undefined;
  const activeCellStyle = activeCellObject
    ? xlsxCellStyleFromCell(activeCellObject)
    : undefined;
  const activeColumnWidth =
    activeCell && sheet
      ? xlsxColumn(sheet, activeCell.column)?.width ?? DEFAULT_XLSX_COLUMN_WIDTH
      : DEFAULT_XLSX_COLUMN_WIDTH;
  const activeRowHeight =
    activeCell && sheet?.rows[activeCell.row]
      ? sheet.rows[activeCell.row].height ?? DEFAULT_XLSX_ROW_HEIGHT
      : DEFAULT_XLSX_ROW_HEIGHT;
  const frozenRows = sheet?.frozenRows ?? 0;
  const frozenColumns = sheet?.frozenColumns ?? 0;
  const selectedValues =
    displayGridSheet && selectedRanges.length > 0
      ? selectedRanges.flatMap((range) =>
          valuesFromXlsxRange(displayGridSheet, columnCount, range, showFormulas),
        )
      : activeCellValue
        ? [[activeCellValue]]
        : [];
  const selectionSummary = summarizeSelection(selectedValues);

  return {
    activeCellObject,
    activeCellReference,
    activeCellStyle,
    activeCellValue,
    activeColumnWidth,
    activeComment,
    activeConditionalRule,
    activeDataValidation,
    activeDefinedNameValue,
    activeHyperlink,
    activeRowHeight,
    activeSingleCellRange,
    columnCount,
    columnWindow,
    displayGridSheet,
    displayRowLimit,
    displayRows,
    displaySheet,
    fillPreviewRange,
    frozenColumns,
    frozenRows,
    leftColumnSpacerWidth,
    recalculatedModel,
    rightColumnSpacerWidth,
    rowWindow,
    selectedRanges,
    selectedValues,
    selectionRange,
    selectionSummary,
    sheet,
    tableResizePreviewRange,
    validationRange,
    visibleColumnIndexes,
    visibleColumns,
    visibleRows,
  };
}
