import { buildXlsxChartSeriesFromSelection } from "./spreadsheetChartSeries";
import {
  buildXlsxTableFromRange,
  inferXlsxTableHeaders,
  resizeXlsxTableToRange,
} from "./spreadsheetEditorUtils";
import {
  clampNumber,
  rangeIndexes,
  rangeToA1,
  singleCellRange,
} from "./spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";
import {
  nonOverlappingComments,
  nonOverlappingConditionalFormattings,
  nonOverlappingDataValidations,
  nonOverlappingHyperlinks,
  nonOverlappingMergedRanges,
} from "./spreadsheetXlsxMetadata";
import { upsertXlsxColumn } from "./spreadsheetXlsxGridModel";
import { xlsxRangeFromRef } from "./spreadsheetGeometry";
import { columnName } from "../shared/models";
import type {
  XlsxChartSeries,
  XlsxComment,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxModel,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheet,
  XlsxSheetProtection,
} from "../shared/models";

type SpreadsheetRangeActionParams = {
  activeCell: CellPosition | null;
  columnCount: number;
  commitXlsxModel: (next: XlsxModel) => void;
  commitSheetSettingsModel: (next: XlsxModel) => void;
  displayGridSheet: XlsxSheet | undefined;
  displayRowLimit: number;
  model: XlsxModel;
  objectEditors: {
    addChartSeries: (chartId: string, series: XlsxChartSeries) => void;
  };
  selectionRange: NormalizedCellRange | null;
  sheet: XlsxSheet | undefined;
  validationRange: NormalizedCellRange | null;
};

/**
 * Range actions centralize metadata updates that must remove or replace
 * overlapping XLSX ranges before writing a new validation, merge, link, or note.
 */
export function createSpreadsheetRangeActions({
  activeCell,
  columnCount,
  commitXlsxModel,
  commitSheetSettingsModel,
  displayGridSheet,
  displayRowLimit,
  model,
  objectEditors,
  selectionRange,
  sheet,
  validationRange,
}: SpreadsheetRangeActionParams) {
  function hideSelectedRows() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) =>
                rowIndex >= selectionRange.top && rowIndex <= selectionRange.bottom
                  ? { ...row, hidden: true }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function hideSelectedColumns() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: rangeIndexes(selectionRange.left, selectionRange.right).reduce(
                (columns, columnIndex) =>
                  upsertXlsxColumn(columns, columnIndex, { hidden: true }),
                item.columns ?? [],
              ),
            }
          : item,
      ),
    });
  }

  function unhideAllRowsAndColumns() {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: (item.columns ?? []).map((column) => ({
                ...column,
                hidden: false,
              })),
              rows: item.rows.map((row) => ({ ...row, hidden: false })),
            }
          : item,
      ),
    });
  }

  function updateFrozenRows(value: number) {
    if (!sheet || !Number.isFinite(value)) return;
    const frozenRows = Math.floor(
      clampNumber(value, 0, Math.max(0, displayRowLimit - 1)),
    );
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, frozenRows: frozenRows || undefined }
          : item,
      ),
    });
  }

  function updateFrozenColumns(value: number) {
    if (!sheet || !Number.isFinite(value)) return;
    const frozenColumns = Math.floor(
      clampNumber(value, 0, Math.max(0, columnCount - 1)),
    );
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, frozenColumns: frozenColumns || undefined }
          : item,
      ),
    });
  }

  function mergeSelection() {
    if (!sheet || !selectionRange || singleCellRange(selectionRange)) return;
    const ref = rangeToA1(selectionRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              mergedRanges: [
                ...nonOverlappingMergedRanges(item.mergedRanges ?? [], selectionRange),
                { ref },
              ],
            }
          : item,
      ),
    });
  }

  function unmergeSelection() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              mergedRanges: nonOverlappingMergedRanges(
                item.mergedRanges ?? [],
                selectionRange,
              ),
            }
          : item,
      ),
    });
  }

  function setAutoFilterFromSelection() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, autoFilter: rangeToA1(selectionRange) }
          : item,
      ),
    });
  }

  function clearAutoFilter() {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, autoFilter: undefined } : item,
      ),
    });
  }

  function createTableFromSelection() {
    if (!sheet || !selectionRange) return;
    const ref = rangeToA1(selectionRange);
    const table = buildXlsxTableFromRange(sheet, selectionRange, ref);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, tables: [...(item.tables ?? []), table] }
          : item,
      ),
    });
  }

  function resizeTableToRange(tableId: string, range: NormalizedCellRange) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tables: (item.tables ?? []).map((table) =>
                table.id === tableId
                  ? resizeXlsxTableToRange(table, item, range)
                  : table,
              ),
            }
          : item,
      ),
    });
  }

  function resizeTableToSelection(tableId: string) {
    if (!selectionRange) return;
    resizeTableToRange(tableId, selectionRange);
  }

  function inferTableHeaders(tableId: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tables: (item.tables ?? []).map((table) => {
                const range = xlsxRangeFromRef(table.ref ?? "");
                return table.id === tableId && range
                  ? inferXlsxTableHeaders(table, item, range)
                  : table;
              }),
            }
          : item,
      ),
    });
  }

  function addChartSeriesFromSelection(chartId: string) {
    if (!sheet || !displayGridSheet || !selectionRange) return;
    const series = buildXlsxChartSeriesFromSelection({
      sheet,
      displaySheet: displayGridSheet,
      columnCount,
      selectionRange,
    });
    if (!series) return;
    objectEditors.addChartSeries(chartId, series);
  }

  function applyDataValidation(validation: XlsxDataValidation | null) {
    if (!sheet || !validationRange) return;
    const sqref = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              dataValidations: validation
                ? [
                    ...nonOverlappingDataValidations(
                      item.dataValidations ?? [],
                      validationRange,
                    ),
                    {
                      ...validation,
                      sqref,
                    },
                  ]
                : nonOverlappingDataValidations(
                    item.dataValidations ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyConditionalFormatting(rule: XlsxConditionalRule | null) {
    if (!sheet || !validationRange) return;
    const sqref = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              conditionalFormattings: rule
                ? [
                    ...nonOverlappingConditionalFormattings(
                      item.conditionalFormattings ?? [],
                      validationRange,
                    ),
                    {
                      sqref,
                      rules: [
                        {
                          ...rule,
                          sourceXml: undefined,
                        },
                      ],
                    },
                  ]
                : nonOverlappingConditionalFormattings(
                    item.conditionalFormattings ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyHyperlink(hyperlink: XlsxHyperlink | null) {
    if (!sheet || !validationRange) return;
    const reference = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              hyperlinks: hyperlink
                ? [
                    ...nonOverlappingHyperlinks(
                      item.hyperlinks ?? [],
                      validationRange,
                    ),
                    {
                      ...hyperlink,
                      ref: reference,
                      relationshipId: undefined,
                    },
                  ]
                : nonOverlappingHyperlinks(
                    item.hyperlinks ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyComment(comment: XlsxComment | null) {
    if (!sheet || !validationRange) return;
    const reference = activeCell
      ? `${columnName(activeCell.column)}${activeCell.row + 1}`
      : `${columnName(validationRange.left)}${validationRange.top + 1}`;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              comments: comment
                ? [
                    ...nonOverlappingComments(
                      item.comments ?? [],
                      validationRange,
                    ),
                    {
                      ...comment,
                      ref: reference,
                    },
                  ]
                : nonOverlappingComments(
                    item.comments ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function updateSheetSettings(patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) {
    if (!sheet) return;
    commitSheetSettingsModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    });
  }

  return {
    addChartSeriesFromSelection,
    applyComment,
    applyConditionalFormatting,
    applyDataValidation,
    applyHyperlink,
    clearAutoFilter,
    createTableFromSelection,
    hideSelectedColumns,
    hideSelectedRows,
    inferTableHeaders,
    mergeSelection,
    resizeTableToRange,
    resizeTableToSelection,
    setAutoFilterFromSelection,
    unhideAllRowsAndColumns,
    unmergeSelection,
    updateFrozenColumns,
    updateFrozenRows,
    updateSheetSettings,
  };
}
