import type { Dispatch, SetStateAction } from "react";
import type { XlsxDefinedName, XlsxModel, XlsxSheet } from "../shared/models";
import { xlsxDefinedNameTarget } from "./spreadsheetDefinedNames";
import type { CellPosition } from "./spreadsheetGeometry";
import {
  clampCellRange,
  scrollCellIntoView,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import {
  xlsxColumnCount,
  xlsxDisplayRowCount,
} from "./spreadsheetXlsxGridModel";

interface SpreadsheetReferenceSelectionContext {
  columnCount: number;
  displayRowLimit: number;
  gridElement: HTMLDivElement | null;
  model: XlsxModel;
  setActiveCell: Dispatch<SetStateAction<CellPosition | null>>;
  setPreferredSheetId: Dispatch<SetStateAction<string | null>>;
  setSelectionAnchor: Dispatch<SetStateAction<CellPosition | null>>;
  setSelectionEnd: Dispatch<SetStateAction<CellPosition | null>>;
  sheet: XlsxSheet | undefined;
}

export function selectSpreadsheetReference(
  reference: string,
  context: SpreadsheetReferenceSelectionContext,
) {
  if (!context.sheet) return;
  const target = xlsxDefinedNameTarget(reference.trim());
  if (target) {
    const targetSheet =
      target.sheetName !== undefined
        ? context.model.sheets.find((item) => item.name === target.sheetName)
        : context.sheet;
    if (!targetSheet) return;
    const targetColumnCount = xlsxColumnCount(targetSheet);
    const targetRowCount = xlsxDisplayRowCount(targetSheet);
    const clamped = clampCellRange(target.range, targetRowCount, targetColumnCount);
    selectRangeOnSheet(targetSheet, clamped, context);
    return;
  }
  const range = xlsxRangeFromRef(reference.trim());
  if (!range) return;
  const clamped = clampCellRange(range, context.displayRowLimit, context.columnCount);
  context.setActiveCell({ row: clamped.top, column: clamped.left });
  context.setSelectionAnchor({ row: clamped.top, column: clamped.left });
  context.setSelectionEnd({ row: clamped.bottom, column: clamped.right });
  scrollCellIntoView(context.gridElement, clamped.top, clamped.left);
}

export function selectSpreadsheetDefinedName(
  definedName: XlsxDefinedName,
  context: SpreadsheetReferenceSelectionContext,
) {
  const target = xlsxDefinedNameTarget(definedName.value);
  if (!target) return;
  const targetSheetIndex =
    target.sheetName !== undefined
      ? context.model.sheets.findIndex((item) => item.name === target.sheetName)
      : definedName.localSheetId;
  const targetSheet =
    targetSheetIndex !== undefined
      ? context.model.sheets[targetSheetIndex]
      : context.sheet;
  if (!targetSheet) return;
  const targetColumnCount = xlsxColumnCount(targetSheet);
  const targetRowCount = xlsxDisplayRowCount(targetSheet);
  const clamped = clampCellRange(target.range, targetRowCount, targetColumnCount);
  selectRangeOnSheet(targetSheet, clamped, context);
}

function selectRangeOnSheet(
  targetSheet: XlsxSheet,
  range: { top: number; left: number; bottom: number; right: number },
  context: SpreadsheetReferenceSelectionContext,
) {
  context.setPreferredSheetId(targetSheet.id);
  context.setActiveCell({ row: range.top, column: range.left });
  context.setSelectionAnchor({ row: range.top, column: range.left });
  context.setSelectionEnd({ row: range.bottom, column: range.right });
  requestAnimationFrame(() => {
    scrollCellIntoView(context.gridElement, range.top, range.left);
  });
}
