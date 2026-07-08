import type { Dispatch, SetStateAction } from "react";
import {
  remapXlsxDefinedNameSheetScopes,
  renameXlsxDefinedNameSheetReferences,
} from "./spreadsheetDefinedNames";
import { nextDefinedName } from "./spreadsheetEditorUtils";
import {
  nextDuplicateSheetName,
  nextGeneratedSheetName,
  renameXlsxSheetName,
} from "./spreadsheetSheetNames";
import { nextXlsxSheetPath } from "./spreadsheetXlsxGridModel";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";
import { columnName } from "../shared/models";
import type { XlsxDefinedName, XlsxModel, XlsxSheet } from "../shared/models";

type SpreadsheetSheetActionParams = {
  activeDefinedNameValue: string | undefined;
  commitXlsxModel: (next: XlsxModel) => void;
  model: XlsxModel;
  selectionRange: NormalizedCellRange | null;
  setActiveCell: Dispatch<SetStateAction<CellPosition | null>>;
  setPreferredSheetId: Dispatch<SetStateAction<string | null>>;
  setSelectionAnchor: Dispatch<SetStateAction<CellPosition | null>>;
  setSelectionEnd: Dispatch<SetStateAction<CellPosition | null>>;
  sheet: XlsxSheet | undefined;
};

/**
 * Workbook-level edits are isolated from grid editing so sheet ordering, naming,
 * and defined-name remapping stay coupled to the workbook structure they mutate.
 */
export function createSpreadsheetSheetActions({
  activeDefinedNameValue,
  commitXlsxModel,
  model,
  selectionRange,
  setActiveCell,
  setPreferredSheetId,
  setSelectionAnchor,
  setSelectionEnd,
  sheet,
}: SpreadsheetSheetActionParams) {
  function clearActiveSelection() {
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function addSheet() {
    const path = nextXlsxSheetPath(model);
    const next = {
      id: path,
      name: nextGeneratedSheetName(model),
      rows: [
        {
          index: "1",
          cells: Array.from({ length: 5 }, (_, index) => ({
            ref: `${columnName(index)}1`,
            value: "",
          })),
        },
      ],
    };
    commitXlsxModel({ sheets: [...model.sheets, next] });
    setPreferredSheetId(next.id);
    clearActiveSelection();
  }

  function duplicateSheet() {
    if (!sheet) return;
    const path = nextXlsxSheetPath(model);
    const next = {
      id: path,
      name: nextDuplicateSheetName(model, sheet.name),
      state: "visible" as const,
      tabColor: sheet.tabColor,
      tabColorSourceXml: sheet.tabColorSourceXml,
      columns: sheet.columns?.map((column) => ({ ...column })),
      mergedRanges: sheet.mergedRanges?.map((range) => ({ ...range })),
      dataValidations: sheet.dataValidations?.map((validation) => ({
        ...validation,
      })),
      conditionalFormattings: sheet.conditionalFormattings?.map((formatting) => ({
        ...formatting,
        rules: formatting.rules.map((rule) => ({ ...rule })),
      })),
      hyperlinks: sheet.hyperlinks?.map((hyperlink) => ({ ...hyperlink })),
      comments: sheet.comments?.map((comment) => ({ ...comment })),
      protection: sheet.protection ? { ...sheet.protection } : undefined,
      pageMargins: sheet.pageMargins ? { ...sheet.pageMargins } : undefined,
      pageSetup: sheet.pageSetup ? { ...sheet.pageSetup } : undefined,
      autoFilter: sheet.autoFilter,
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
      rows: sheet.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell })),
      })),
    };
    commitXlsxModel({ sheets: [...model.sheets, next] });
    setPreferredSheetId(next.id);
    clearActiveSelection();
  }

  function deleteSheet() {
    if (!sheet || model.sheets.length <= 1) return;
    const nextSheets = model.sheets.filter((item) => item.id !== sheet.id);
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: remapXlsxDefinedNameSheetScopes(
        model.definedNames,
        model.sheets,
        nextSheets,
      ),
    });
    setPreferredSheetId(nextSheets[0]?.id ?? null);
    clearActiveSelection();
  }

  function renameSheet(name: string) {
    if (!sheet) return;
    const nextName = renameXlsxSheetName(model, sheet.id, name);
    if (nextName === sheet.name) return;
    const nextSheets = model.sheets.map((item) =>
      item.id === sheet.id ? { ...item, name: nextName } : item,
    );
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: renameXlsxDefinedNameSheetReferences(
        model.definedNames,
        sheet.name,
        nextName,
      ),
    });
  }

  function updateSheetState(state: XlsxSheet["state"]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, state: state === "visible" ? "visible" : state }
          : item,
      ),
    });
  }

  function updateSheetTabColor(tabColor: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tabColor,
              tabColorSourceXml: undefined,
            }
          : item,
      ),
    });
  }

  function moveSheet(direction: -1 | 1) {
    if (!sheet) return;
    const index = model.sheets.findIndex((item) => item.id === sheet.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= model.sheets.length) return;
    const nextSheets = [...model.sheets];
    const [moved] = nextSheets.splice(index, 1);
    nextSheets.splice(nextIndex, 0, moved);
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: remapXlsxDefinedNameSheetScopes(
        model.definedNames,
        model.sheets,
        nextSheets,
      ),
    });
  }

  function addDefinedNameFromSelection() {
    if (!sheet || !selectionRange || !activeDefinedNameValue) return;
    const localSheetId = model.sheets.findIndex((item) => item.id === sheet.id);
    const next: XlsxDefinedName = {
      name: nextDefinedName(model.definedNames ?? [], localSheetId),
      value: activeDefinedNameValue,
      localSheetId: localSheetId >= 0 ? localSheetId : undefined,
    };
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: [...(model.definedNames ?? []), next],
    });
  }

  function updateDefinedName(index: number, next: XlsxDefinedName) {
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: (model.definedNames ?? []).map((definedName, currentIndex) =>
        currentIndex === index ? next : definedName,
      ),
    });
  }

  function deleteDefinedName(index: number) {
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: (model.definedNames ?? []).filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    });
  }

  return {
    addDefinedNameFromSelection,
    addSheet,
    deleteDefinedName,
    deleteSheet,
    duplicateSheet,
    moveSheet,
    renameSheet,
    updateDefinedName,
    updateSheetState,
    updateSheetTabColor,
  };
}
