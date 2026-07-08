import type { XlsxDefinedName, XlsxSheet } from "../shared/models";
import {
  rangeToA1,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import type { NormalizedCellRange } from "./spreadsheetGeometry";

interface DefinedNameTarget {
  sheetName?: string;
  reference: string;
  range: NormalizedCellRange;
}

/**
 * Defined names live at workbook scope while their references often target a
 * specific sheet. These helpers keep that workbook-level metadata synchronized
 * with sheet edits without teaching the main spreadsheet editor how to parse
 * Excel's sheet-qualified A1 references.
 */
export function xlsxDefinedNameTarget(value: string): DefinedNameTarget | null {
  const trimmed = value.trim().replace(/^=/, "");
  const match =
    /^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i.exec(
      trimmed,
    );
  if (!match) return null;
  const range = xlsxRangeFromRef(match[3]);
  if (!range) return null;
  return {
    sheetName: match[1]?.replace(/''/g, "'") ?? match[2],
    reference: match[3],
    range,
  };
}

export function xlsxDefinedNameValueForSheet(
  sheetName: string,
  range: NormalizedCellRange,
) {
  return `${quoteXlsxSheetName(sheetName)}!${rangeToA1(range)}`;
}

export function shiftXlsxDefinedNamesForRowInsert(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  sheetId: string,
  insertAt: number,
) {
  return shiftXlsxDefinedNames(definedNames, sheets, sheetId, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) return { ...range, bottom: range.bottom + 1 };
    return range;
  });
}

export function shiftXlsxDefinedNamesForColumnInsert(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  sheetId: string,
  insertAt: number,
) {
  return shiftXlsxDefinedNames(definedNames, sheets, sheetId, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) return { ...range, right: range.right + 1 };
    return range;
  });
}

export function shiftXlsxDefinedNamesForRowDelete(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  sheetId: string,
  deleteAt: number,
) {
  return shiftXlsxDefinedNames(definedNames, sheets, sheetId, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return { ...range, bottom: range.bottom - 1 };
  });
}

export function shiftXlsxDefinedNamesForColumnDelete(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  sheetId: string,
  deleteAt: number,
) {
  return shiftXlsxDefinedNames(definedNames, sheets, sheetId, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return { ...range, right: range.right - 1 };
  });
}

export function remapXlsxDefinedNameSheetScopes(
  definedNames: XlsxDefinedName[] | undefined,
  previousSheets: XlsxSheet[],
  nextSheets: XlsxSheet[],
) {
  if (!definedNames) return undefined;
  const previousSheetIds = previousSheets.map((sheet) => sheet.id);
  const nextIndexById = new Map(nextSheets.map((sheet, index) => [sheet.id, index]));
  return definedNames
    .map((definedName) => {
      if (definedName.localSheetId === undefined) return definedName;
      const sheetId = previousSheetIds[definedName.localSheetId];
      const nextIndex = sheetId ? nextIndexById.get(sheetId) : undefined;
      if (nextIndex === undefined) return null;
      return { ...definedName, localSheetId: nextIndex };
    })
    .filter((definedName): definedName is XlsxDefinedName => definedName !== null);
}

export function renameXlsxDefinedNameSheetReferences(
  definedNames: XlsxDefinedName[] | undefined,
  oldName: string,
  nextName: string,
) {
  if (!definedNames) return undefined;
  return definedNames.map((definedName) => {
    const target = xlsxDefinedNameTarget(definedName.value);
    if (target?.sheetName !== oldName) return definedName;
    return {
      ...definedName,
      sourceXml: undefined,
      value: `${quoteXlsxSheetName(nextName)}!${rangeToA1(target.range)}`,
    };
  });
}

function shiftXlsxDefinedNames(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  sheetId: string,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  if (!definedNames) return undefined;
  const targetSheetIndex = sheets.findIndex((sheet) => sheet.id === sheetId);
  const targetSheet = sheets[targetSheetIndex];
  if (!targetSheet) return definedNames;
  return definedNames
    .map((definedName) => {
      const target = xlsxDefinedNameTarget(definedName.value);
      if (!target) return definedName;
      if (!definedNameAppliesToSheet(definedName, target, targetSheet.name, targetSheetIndex)) {
        return definedName;
      }
      const shifted = mapRange(target.range);
      if (!shifted) return null;
      return {
        ...definedName,
        sourceXml: undefined,
        value: `${target.sheetName ? `${quoteXlsxSheetName(target.sheetName)}!` : ""}${rangeToA1(
          shifted,
        )}`,
      };
    })
    .filter((definedName): definedName is XlsxDefinedName => definedName !== null);
}

function definedNameAppliesToSheet(
  definedName: XlsxDefinedName,
  target: DefinedNameTarget,
  sheetName: string,
  sheetIndex: number,
) {
  if (target.sheetName) return target.sheetName === sheetName;
  return definedName.localSheetId === sheetIndex;
}

function quoteXlsxSheetName(sheetName: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)) return sheetName;
  return `'${sheetName.replace(/'/g, "''")}'`;
}
