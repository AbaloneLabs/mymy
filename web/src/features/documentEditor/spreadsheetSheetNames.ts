import type { XlsxModel } from "./models";

const XLSX_SHEET_NAME_LIMIT = 31;
const XLSX_INVALID_SHEET_NAME_CHARACTERS = /[[\]:*?/\\]/g;

export function nextGeneratedSheetName(model: XlsxModel) {
  const usedNames = xlsxSheetNameSet(model);
  let index = model.sheets.length + 1;
  let name = `Sheet ${index}`;
  while (usedNames.has(name.toLocaleLowerCase())) {
    index += 1;
    name = `Sheet ${index}`;
  }
  return name;
}

export function nextDuplicateSheetName(model: XlsxModel, sourceName: string) {
  return nextUniqueSheetName(model, sourceName || "Sheet");
}

export function renameXlsxSheetName(
  model: XlsxModel,
  sheetId: string,
  name: string,
) {
  return nextUniqueSheetName(model, name, sheetId);
}

function nextUniqueSheetName(
  model: XlsxModel,
  sourceName: string,
  ignoredSheetId?: string,
) {
  const usedNames = xlsxSheetNameSet(model, ignoredSheetId);
  const baseName = normalizeGeneratedSheetName(sourceName || "Sheet");
  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;
  let index = 2;
  let name = withSheetNameSuffix(baseName, index);
  while (usedNames.has(name.toLocaleLowerCase())) {
    index += 1;
    name = withSheetNameSuffix(baseName, index);
  }
  return name;
}

function xlsxSheetNameSet(model: XlsxModel, ignoredSheetId?: string) {
  return new Set(
    model.sheets
      .filter((sheet) => sheet.id !== ignoredSheetId)
      .map((sheet) => sheet.name.toLocaleLowerCase()),
  );
}

function normalizeGeneratedSheetName(name: string) {
  const normalized = name
    .replace(XLSX_INVALID_SHEET_NAME_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Sheet").slice(0, XLSX_SHEET_NAME_LIMIT);
}

function withSheetNameSuffix(baseName: string, index: number) {
  const suffix = ` (${index})`;
  return `${baseName.slice(0, XLSX_SHEET_NAME_LIMIT - suffix.length)}${suffix}`;
}
