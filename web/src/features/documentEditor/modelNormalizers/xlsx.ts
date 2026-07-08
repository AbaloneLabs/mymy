import type { XlsxDefinedName, XlsxModel } from "../shared/models";
import { isRecord } from "./shared";
import { normalizeXlsxSheet } from "./xlsx/sheet";
import { normalizeXlsxDefinedName } from "./xlsx/workbook";

export function normalizeXlsxModel(model: unknown): XlsxModel {
  if (!isRecord(model) || !Array.isArray(model.sheets)) return { sheets: [] };
  return {
    definedNames: Array.isArray(model.definedNames)
      ? model.definedNames
          .map((definedName) => normalizeXlsxDefinedName(definedName))
          .filter(
            (definedName): definedName is XlsxDefinedName =>
              definedName !== null,
          )
      : undefined,
    sheets: model.sheets.map((sheet, sheetIndex) =>
      normalizeXlsxSheet(sheet, sheetIndex),
    ),
  };
}
