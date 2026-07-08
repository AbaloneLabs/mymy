import {
  compareSpreadsheetFormulaValues,
  spreadsheetFormulaArray,
  spreadsheetFormulaAsArray,
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
  spreadsheetFormulaValuesEqual,
  spreadsheetFormulaValueText,
  wildcardSpreadsheetFormulaPattern,
} from "./spreadsheetFormulaValues";
import type { SpreadsheetFormulaValue } from "./spreadsheetFormulaValues";

export function spreadsheetFormulaIndex(
  arrayValue: SpreadsheetFormulaValue | undefined,
  row: number,
  column: number,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array || row < 1 || column < 1) return "#REF!";
  const index = (row - 1) * array.width + (column - 1);
  return array.values[index] ?? "#REF!";
}

export function spreadsheetFormulaMatch(
  lookupValue: SpreadsheetFormulaValue,
  arrayValue: SpreadsheetFormulaValue | undefined,
  matchType: number,
) {
  const values = spreadsheetFormulaAsArray(arrayValue)?.values ?? [];
  if (values.length === 0) return "#N/A";
  if (matchType === 0) {
    const index = values.findIndex((value) =>
      spreadsheetFormulaValuesEqual(value, lookupValue),
    );
    return index < 0 ? "#N/A" : index + 1;
  }
  const lookupNumber = spreadsheetFormulaValueNumber(lookupValue);
  let bestIndex = -1;
  values.forEach((value, index) => {
    const number = spreadsheetFormulaValueNumber(value);
    if (
      (matchType > 0 && number <= lookupNumber) ||
      (matchType < 0 && number >= lookupNumber)
    ) {
      bestIndex = index;
    }
  });
  return bestIndex < 0 ? "#N/A" : bestIndex + 1;
}

export function spreadsheetFormulaXMatch(
  lookupValue: SpreadsheetFormulaValue,
  arrayValue: SpreadsheetFormulaValue | undefined,
  matchMode: number,
  searchMode: number,
) {
  const values = spreadsheetFormulaAsArray(arrayValue)?.values ?? [];
  const indexes = values.map((_, index) => index);
  if (searchMode === -1) indexes.reverse();
  const exact = indexes.find((index) =>
    spreadsheetFormulaValuesEqual(values[index] ?? "", lookupValue),
  );
  if (exact !== undefined) return exact + 1;
  if (matchMode === 2) {
    const pattern = wildcardSpreadsheetFormulaPattern(spreadsheetFormulaValueText(lookupValue));
    const wildcard = indexes.find((index) =>
      pattern.test(spreadsheetFormulaValueText(values[index] ?? "")),
    );
    if (wildcard !== undefined) return wildcard + 1;
  }
  if (matchMode === -1 || matchMode === 1) {
    return spreadsheetFormulaMatch(lookupValue, arrayValue, matchMode);
  }
  return "#N/A";
}

export function spreadsheetFormulaXLookup(
  lookupValue: SpreadsheetFormulaValue,
  lookupArrayValue: SpreadsheetFormulaValue | undefined,
  returnArrayValue: SpreadsheetFormulaValue | undefined,
  fallback: SpreadsheetFormulaValue | undefined,
  matchMode: number,
  searchMode: number,
) {
  const lookupArray = spreadsheetFormulaAsArray(lookupArrayValue);
  const returnArray = spreadsheetFormulaAsArray(returnArrayValue);
  if (!lookupArray || !returnArray) return fallback ?? "#N/A";
  const position = spreadsheetFormulaXMatch(
    lookupValue,
    lookupArray,
    matchMode,
    searchMode,
  );
  if (typeof position !== "number") return fallback ?? position;
  return returnArray.values[position - 1] ?? fallback ?? "#N/A";
}

export function spreadsheetFormulaTableLookup(
  lookupValue: SpreadsheetFormulaValue,
  tableValue: SpreadsheetFormulaValue | undefined,
  resultIndex: number,
  approximate: boolean,
  direction: "vertical" | "horizontal",
) {
  const table = spreadsheetFormulaAsArray(tableValue);
  if (!table || resultIndex < 1) return "#N/A";
  if (direction === "vertical") {
    const lookupColumn = Array.from({ length: table.height }, (_, row) =>
      table.values[row * table.width] ?? "",
    );
    const position = spreadsheetFormulaMatch(
      lookupValue,
      spreadsheetFormulaArray(lookupColumn, 1, lookupColumn.length),
      approximate ? 1 : 0,
    );
    if (typeof position !== "number") return position;
    return table.values[(position - 1) * table.width + resultIndex - 1] ?? "#REF!";
  }
  const lookupRow = table.values.slice(0, table.width);
  const position = spreadsheetFormulaMatch(
    lookupValue,
    spreadsheetFormulaArray(lookupRow, lookupRow.length, 1),
    approximate ? 1 : 0,
  );
  if (typeof position !== "number") return position;
  return table.values[(resultIndex - 1) * table.width + position - 1] ?? "#REF!";
}

export function spreadsheetFormulaFilter(
  arrayValue: SpreadsheetFormulaValue | undefined,
  includeValue: SpreadsheetFormulaValue | undefined,
  fallback: SpreadsheetFormulaValue | undefined,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  const include = spreadsheetFormulaAsArray(includeValue);
  if (!array || !include) return fallback ?? "#CALC!";
  const values = array.values.filter((_, index) =>
    spreadsheetFormulaValueBoolean(include.values[index] ?? false),
  );
  return values.length > 0
    ? spreadsheetFormulaArray(
        values,
        Math.min(array.width, values.length),
        Math.ceil(values.length / Math.max(array.width, 1)),
      )
    : (fallback ?? "#CALC!");
}

export function spreadsheetFormulaUnique(arrayValue: SpreadsheetFormulaValue | undefined) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array) return "#CALC!";
  const seen = new Set<string>();
  const values = array.values.filter((value) => {
    const key = spreadsheetFormulaValueText(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return spreadsheetFormulaArray(
    values,
    Math.min(array.width, values.length),
    Math.ceil(values.length / Math.max(array.width, 1)),
  );
}

export function spreadsheetFormulaSort(
  arrayValue: SpreadsheetFormulaValue | undefined,
  sortIndex: number,
  sortOrder: number,
) {
  const array = spreadsheetFormulaAsArray(arrayValue);
  if (!array || array.width === 0) return "#CALC!";
  const targetColumn = Math.max(0, Math.min(array.width - 1, sortIndex - 1));
  const rows = Array.from({ length: array.height }, (_, rowIndex) =>
    array.values.slice(rowIndex * array.width, rowIndex * array.width + array.width),
  );
  rows.sort((left, right) => {
    const comparison = compareSpreadsheetFormulaValues(
      left[targetColumn] ?? "",
      right[targetColumn] ?? "",
      "<",
    );
    if (comparison === true) return sortOrder < 0 ? 1 : -1;
    const reverseComparison = compareSpreadsheetFormulaValues(
      left[targetColumn] ?? "",
      right[targetColumn] ?? "",
      ">",
    );
    if (reverseComparison === true) return sortOrder < 0 ? -1 : 1;
    return 0;
  });
  return spreadsheetFormulaArray(rows.flat(), array.width, rows.length);
}
