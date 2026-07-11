import type { Dispatch, SetStateAction } from "react";
import { remapXlsxDefinedNameSheetScopes } from "./spreadsheetDefinedNames";
import { nextDefinedName } from "./spreadsheetEditorUtils";
import {
  nextDuplicateSheetName,
  nextGeneratedSheetName,
  renameXlsxSheetName,
} from "./spreadsheetSheetNames";
import { nextXlsxSheetPath } from "./spreadsheetXlsxGridModel";
import type { CellPosition, NormalizedCellRange } from "./spreadsheetGeometry";
import { columnName } from "../shared/models";
import type { XlsxDefinedName, XlsxModel, XlsxSheet } from "../shared/models";
import {
  analyzeXlsxSheetDeletion,
  invalidateXlsxWorkbookSheetReferences,
  renameXlsxWorkbookSheetReferences,
} from "./spreadsheetWorkbookReferences";
import type { XlsxSheetDeletionImpact } from "./spreadsheetWorkbookReferences";

export interface XlsxSheetDeletionPreview {
  sheetId: string;
  sheetName: string;
  impacts: XlsxSheetDeletionImpact[];
  populatedCells: number;
  ownedObjects: number;
  signature: string;
}

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
    if (!sheet || xlsxSheetDuplicateBlockReason(sheet)) return;
    const path = nextXlsxSheetPath(model);
    const sourceSheetIndex = model.sheets.findIndex(
      (item) => item.id === sheet.id,
    );
    const duplicateSheetIndex = model.sheets.length;
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
      conditionalFormattings: sheet.conditionalFormattings?.map(
        (formatting) => ({
          ...formatting,
          rules: formatting.rules.map((rule) => ({ ...rule })),
        }),
      ),
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
    const duplicatedLocalNames = (model.definedNames ?? [])
      .filter((definedName) => definedName.localSheetId === sourceSheetIndex)
      .map((definedName) => ({
        ...definedName,
        localSheetId: duplicateSheetIndex,
        sourceXml: undefined,
      }));
    commitXlsxModel({
      sheets: [...model.sheets, next],
      definedNames: [...(model.definedNames ?? []), ...duplicatedLocalNames],
    });
    setPreferredSheetId(next.id);
    clearActiveSelection();
  }

  function deleteSheet(confirmation?: XlsxSheetDeletionPreview) {
    if (!sheet || model.sheets.length <= 1) return null;
    const preview = buildXlsxSheetDeletionPreview(model, sheet);
    if (
      !confirmation ||
      confirmation.sheetId !== preview.sheetId ||
      confirmation.signature !== preview.signature
    ) {
      return preview;
    }
    const invalidated = invalidateXlsxWorkbookSheetReferences(model, sheet.name);
    const nextSheets = invalidated.sheets.filter((item) => item.id !== sheet.id);
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: remapXlsxDefinedNameSheetScopes(
        invalidated.definedNames,
        invalidated.sheets,
        nextSheets,
      ),
    });
    setPreferredSheetId(nextSheets[0]?.id ?? null);
    clearActiveSelection();
    return null;
  }

  function renameSheet(name: string) {
    if (!sheet) return;
    const nextName = renameXlsxSheetName(model, sheet.id, name);
    if (nextName === sheet.name) return;
    const nextSheets = model.sheets.map((item) =>
      item.id === sheet.id ? { ...item, name: nextName } : item,
    );
    commitXlsxModel(
      renameXlsxWorkbookSheetReferences(
        { sheets: nextSheets, definedNames: model.definedNames },
        sheet.name,
        nextName,
      ),
    );
  }

  function updateSheetState(state: XlsxSheet["state"]) {
    if (!sheet) return;
    if (state !== "visible" && !canHideXlsxSheet(model.sheets, sheet.id))
      return;
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
      definedNames: (model.definedNames ?? []).map(
        (definedName, currentIndex) =>
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

export function buildXlsxSheetDeletionPreview(
  model: XlsxModel,
  sheet: XlsxSheet,
): XlsxSheetDeletionPreview {
  const impacts = analyzeXlsxSheetDeletion(model, sheet.id);
  const populatedCells = sheet.rows.reduce(
    (count, row) =>
      count +
      row.cells.filter((cell) => cell.value !== "" || Boolean(cell.formula)).length,
    0,
  );
  const ownedObjects =
    (sheet.tables?.length ?? 0) +
    (sheet.charts?.length ?? 0) +
    (sheet.images?.length ?? 0) +
    (sheet.pivots?.length ?? 0) +
    (sheet.comments?.length ?? 0);
  const signature = JSON.stringify({
    sheetId: sheet.id,
    populatedCells,
    ownedObjects,
    impacts,
  });
  return {
    sheetId: sheet.id,
    sheetName: sheet.name,
    impacts,
    populatedCells,
    ownedObjects,
    signature,
  };
}

/**
 * New worksheets can currently serialize cell-level features, but the OOXML
 * writer cannot clone drawing, chart, table, or pivot relationship graphs for
 * a newly allocated sheet. Blocking that combination is safer than producing
 * a duplicate tab that silently points at missing or shared package parts.
 */
export function xlsxSheetDuplicateBlockReason(sheet: XlsxSheet | undefined) {
  if (!sheet) return "Select a sheet to duplicate";
  if ((sheet.tables?.length ?? 0) > 0)
    return "Tables cannot be duplicated safely yet";
  if ((sheet.charts?.length ?? 0) > 0)
    return "Charts cannot be duplicated safely yet";
  if ((sheet.images?.length ?? 0) > 0)
    return "Images cannot be duplicated safely yet";
  if ((sheet.pivots?.length ?? 0) > 0)
    return "Pivot tables cannot be duplicated safely yet";
  return null;
}

export function canHideXlsxSheet(sheets: XlsxSheet[], sheetId: string) {
  const target = sheets.find((sheet) => sheet.id === sheetId);
  if (!target || target.state === "hidden" || target.state === "veryHidden") {
    return true;
  }
  return sheets.some(
    (sheet) =>
      sheet.id !== sheetId &&
      sheet.state !== "hidden" &&
      sheet.state !== "veryHidden",
  );
}
