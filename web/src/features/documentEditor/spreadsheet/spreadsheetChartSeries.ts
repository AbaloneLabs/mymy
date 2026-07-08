import { xlsxDefinedNameValueForSheet } from "./spreadsheetDefinedNames";
import type { XlsxChartSeries, XlsxSheet } from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import { valuesFromXlsxRange } from "./spreadsheetXlsxGridModel";

export function buildXlsxChartSeriesFromSelection({
  sheet,
  displaySheet,
  columnCount,
  selectionRange,
}: {
  sheet: XlsxSheet;
  displaySheet: XlsxSheet;
  columnCount: number;
  selectionRange: NormalizedCellRange;
}): XlsxChartSeries | null {
  const hasHeader = selectionRange.bottom > selectionRange.top;
  const dataTop = hasHeader ? selectionRange.top + 1 : selectionRange.top;
  if (dataTop > selectionRange.bottom) return null;

  const valueColumn = selectionRange.right;
  const valueRange: NormalizedCellRange = {
    top: dataTop,
    right: valueColumn,
    bottom: selectionRange.bottom,
    left: valueColumn,
  };
  const categoryRange: NormalizedCellRange | null =
    selectionRange.left < selectionRange.right
      ? {
          top: dataTop,
          right: selectionRange.left,
          bottom: selectionRange.bottom,
          left: selectionRange.left,
        }
      : null;
  const nameRange: NormalizedCellRange | null = hasHeader
    ? {
        top: selectionRange.top,
        right: valueColumn,
        bottom: selectionRange.top,
        left: valueColumn,
      }
    : null;

  return {
    name: nameRange
      ? flattenSpreadsheetValues(
          valuesFromXlsxRange(displaySheet, columnCount, nameRange, false),
        )[0]
      : undefined,
    nameFormula: nameRange
      ? xlsxDefinedNameValueForSheet(sheet.name, nameRange)
      : undefined,
    categories: categoryRange
      ? flattenSpreadsheetValues(
          valuesFromXlsxRange(displaySheet, columnCount, categoryRange, false),
        )
      : undefined,
    categoriesFormula: categoryRange
      ? xlsxDefinedNameValueForSheet(sheet.name, categoryRange)
      : undefined,
    values: flattenSpreadsheetValues(
      valuesFromXlsxRange(displaySheet, columnCount, valueRange, false),
    ),
    valuesFormula: xlsxDefinedNameValueForSheet(sheet.name, valueRange),
  };
}

function flattenSpreadsheetValues(values: string[][]) {
  return values.flatMap((row) => row);
}
