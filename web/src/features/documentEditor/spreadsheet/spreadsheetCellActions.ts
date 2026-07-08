import { createSpreadsheetCellValueActions } from "./spreadsheetCellValueActions";
import { createSpreadsheetSheetStructureActions } from "./spreadsheetSheetStructureActions";
import type { SpreadsheetCellActionParams } from "./spreadsheetCellActionTypes";

/**
 * Cell actions are kept as a plain factory so the React component owns UI state,
 * while workbook mutations remain testable data transforms with explicit inputs.
 */
export function createSpreadsheetCellActions(params: SpreadsheetCellActionParams) {
  return {
    ...createSpreadsheetSheetStructureActions(params),
    ...createSpreadsheetCellValueActions(params),
  };
}

export type { SpreadsheetCellActionParams } from "./spreadsheetCellActionTypes";
