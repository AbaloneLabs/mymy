import {
  rangeToA1,
  xlsxCellPositionFromRef,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import { evaluateSpreadsheetFormula } from "./spreadsheetFormulaParser";
import {
  formatSpreadsheetFormulaResult,
  isSpreadsheetFormulaArray,
} from "./spreadsheetFormulaValues";
import type { SpreadsheetFormulaEvaluationContext } from "./spreadsheetFormulaTypes";
import type { SpreadsheetFormulaValue } from "./spreadsheetFormulaValues";
import { xlsxDefinedNameTarget } from "./spreadsheetDefinedNames";
import { xlsxStructuredReferenceRange } from "./spreadsheetStructuredReferences";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type {
  XlsxCell,
  XlsxModel,
  XlsxRow,
  XlsxSheet,
} from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import {
  ensureXlsxRows,
  xlsxColumnCount,
} from "./spreadsheetXlsxGridModel";

export function recalculateXlsxModel(model: XlsxModel): XlsxModel {
  const normalizedSheets = model.sheets.map((sheet) =>
    normalizeXlsxSheetRows(clearGeneratedXlsxSheet(sheet), xlsxColumnCount(sheet)),
  );
  const sheetByName = new Map(
    normalizedSheets.map((sheet) => [sheet.name.trim().toLowerCase(), sheet]),
  );
  const sheetIndexById = new Map(
    normalizedSheets.map((sheet, index) => [sheet.id, index]),
  );
  const cellsBySheetId = new Map(
    normalizedSheets.map((sheet) => [sheet.id, xlsxCellsByRef(sheet)]),
  );
  const cache = new Map<string, SpreadsheetFormulaValue>();

  function sheetForReference(reference: string, currentSheet: XlsxSheet) {
    const sheetName = xlsxFormulaReferenceSheetName(reference);
    if (!sheetName) return currentSheet;
    return sheetByName.get(sheetName.trim().toLowerCase()) ?? currentSheet;
  }

  function evaluateCell(
    sheet: XlsxSheet,
    reference: string,
    visiting = new Set<string>(),
  ): SpreadsheetFormulaValue {
    const normalized = normalizeFormulaRef(reference);
    const key = `${sheet.id}:${normalized}`;
    if (cache.has(key)) return cache.get(key) ?? "";
    const cell = cellsBySheetId.get(sheet.id)?.get(normalized);
    if (!cell) return "";
    if (!cell.formula) return cell.value;
    if (visiting.has(key)) return "#CYCLE!";
    const nextVisiting = new Set(visiting);
    nextVisiting.add(key);
    const value = evaluateFormulaValue(cell.formula, cell.value, {
      valueForRef: (ref) => {
        const targetSheet = sheetForReference(ref, sheet);
        return evaluateCell(targetSheet, ref, nextVisiting);
      },
      valuesForRange: (startRef, endRef) => {
        const targetSheet = sheetForReference(startRef, sheet);
        return referencesForRange(startRef, endRef).map((ref) =>
          evaluateCell(targetSheet, ref, nextVisiting),
        );
      },
      valuesForName: (name) =>
        valuesForDefinedName(
          name,
          sheet,
          sheetIndexById.get(sheet.id) ?? -1,
          nextVisiting,
        ),
      valuesForStructuredReference: (structuredReference) => {
        const resolved = xlsxStructuredReferenceRange(structuredReference, {
          currentCellReference: reference,
          currentSheet: sheet,
          sheets: normalizedSheets,
        });
        if (!resolved) return null;
        return {
          height: resolved.height,
          values: resolved.references.map((ref) =>
            evaluateCell(resolved.sheet, ref, nextVisiting),
          ),
          width: resolved.width,
        };
      },
    });
    cache.set(key, value);
    return value;
  }

  function valuesForDefinedName(
    name: string,
    currentSheet: XlsxSheet,
    currentSheetIndex: number,
    visiting: Set<string>,
  ) {
    const normalizedName = name.trim().toLowerCase();
    const definedName =
      model.definedNames?.find(
        (item) =>
          item.name.trim().toLowerCase() === normalizedName &&
          item.localSheetId === currentSheetIndex,
      ) ??
      model.definedNames?.find(
        (item) =>
          item.name.trim().toLowerCase() === normalizedName &&
          item.localSheetId === undefined,
      );
    if (!definedName) return [];
    const target = xlsxDefinedNameTarget(definedName.value);
    if (!target) return [];
    const targetSheet =
      target.sheetName !== undefined
        ? sheetByName.get(target.sheetName.trim().toLowerCase())
        : definedName.localSheetId !== undefined
          ? normalizedSheets[definedName.localSheetId]
          : currentSheet;
    if (!targetSheet) return [];
    return rangeReferences(target.range).map((reference) =>
      evaluateCell(targetSheet, reference, visiting),
    );
  }

  return {
    definedNames: model.definedNames?.map((definedName) => ({ ...definedName })),
    sheets: normalizedSheets.map((sheet) => {
      const formulaResults = new Map<string, SpreadsheetFormulaValue>();
      const recalculatedSheet = {
        ...sheet,
        rows: sheet.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => {
            const sourceCell = clearGeneratedXlsxCell(cell);
            if (!sourceCell.formula) return sourceCell;
            const value = evaluateCell(sheet, sourceCell.ref);
            formulaResults.set(normalizeFormulaRef(sourceCell.ref), value);
            return {
              ...sourceCell,
              value: formatFormulaValueForCell(value, sourceCell.value),
              spillRange: undefined,
            };
          }),
        })),
      };
      return materializeXlsxSpillRanges(recalculatedSheet, formulaResults);
    }),
  };
}

export function recalculateXlsxSheet(sheet: XlsxSheet, columnCount: number): XlsxSheet {
  const normalizedSheet = normalizeXlsxSheetRows(
    clearGeneratedXlsxSheet(sheet),
    columnCount,
  );
  const cellsByRef = xlsxCellsByRef(normalizedSheet);

  const cache = new Map<string, SpreadsheetFormulaValue>();
  function evaluateCell(reference: string, visiting = new Set<string>()): SpreadsheetFormulaValue {
    const normalized = normalizeFormulaRef(reference);
    if (cache.has(normalized)) return cache.get(normalized) ?? "";
    const cell = cellsByRef.get(normalized);
    if (!cell) return "";
    if (!cell.formula) return cell.value;
    if (visiting.has(normalized)) return "#CYCLE!";
    const nextVisiting = new Set(visiting);
    nextVisiting.add(normalized);
    const value = evaluateFormulaValue(cell.formula, cell.value, {
      valueForRef: (ref) => evaluateCell(ref, nextVisiting),
      valuesForRange: (startRef, endRef) =>
        referencesForRange(startRef, endRef).map((ref) =>
          evaluateCell(ref, nextVisiting),
        ),
    });
    cache.set(normalized, value);
    return value;
  }

  const formulaResults = new Map<string, SpreadsheetFormulaValue>();
  const recalculatedSheet = {
    ...normalizedSheet,
    rows: normalizedSheet.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        const sourceCell = clearGeneratedXlsxCell(cell);
        if (!sourceCell.formula) return sourceCell;
        const value = evaluateCell(sourceCell.ref);
        formulaResults.set(normalizeFormulaRef(sourceCell.ref), value);
        return {
          ...sourceCell,
          value: formatFormulaValueForCell(value, sourceCell.value),
          spillRange: undefined,
        };
      }),
    })),
  };
  return materializeXlsxSpillRanges(recalculatedSheet, formulaResults);
}

function normalizeXlsxRowForPosition(
  row: XlsxRow,
  rowIndex: number,
  columnCount: number,
): XlsxRow {
  const index = String(rowIndex + 1);
  return {
    ...row,
    index,
    cells: normalizeXlsxCells(row.cells, columnCount, index).map((cell, cellIndex) => ({
      ...cell,
      ref: `${columnName(cellIndex)}${index}`,
    })),
  };
}

function normalizeXlsxSheetRows(sheet: XlsxSheet, columnCount: number): XlsxSheet {
  return {
    ...sheet,
    rows: sheet.rows.map((row, rowIndex) =>
      normalizeXlsxRowForPosition(row, rowIndex, columnCount),
    ),
  };
}

function xlsxCellsByRef(sheet: XlsxSheet) {
  const cellsByRef = new Map<string, XlsxCell>();
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      cellsByRef.set(normalizeFormulaRef(cell.ref), cell);
    }
  }
  return cellsByRef;
}

function evaluateFormulaValue(
  formula: string,
  fallback: string,
  context: SpreadsheetFormulaEvaluationContext,
): SpreadsheetFormulaValue {
  try {
    const result = evaluateSpreadsheetFormula(formula, context);
    if (typeof result === "number" && !Number.isFinite(result)) return fallback;
    return result;
  } catch {
    return fallback;
  }
}

function formatFormulaValueForCell(value: SpreadsheetFormulaValue, fallback = "") {
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  return formatSpreadsheetFormulaResult(value);
}

function clearGeneratedXlsxCell(cell: XlsxCell): XlsxCell {
  if (cell.generated !== "spill") return cell;
  return {
    ...cell,
    value: "",
    formula: undefined,
    formulaType: undefined,
    formulaRef: undefined,
    formulaSharedIndex: undefined,
    generated: undefined,
    spillParent: undefined,
    spillRange: undefined,
  };
}

function clearGeneratedXlsxSheet(sheet: XlsxSheet): XlsxSheet {
  return {
    ...sheet,
    rows: sheet.rows.map((row) => ({
      ...row,
      cells: row.cells.map(clearGeneratedXlsxCell),
    })),
  };
}

function materializeXlsxSpillRanges(
  sheet: XlsxSheet,
  formulaResults: Map<string, SpreadsheetFormulaValue>,
): XlsxSheet {
  const spillResults = [...formulaResults.entries()]
    .map(([reference, value]) => ({ reference, value }))
    .filter(({ value }) => isSpreadsheetFormulaArray(value));
  if (spillResults.length === 0) return sheet;

  const requiredRows = Math.max(
    sheet.rows.length,
    ...spillResults.map(({ reference, value }) => {
      const position = xlsxCellPositionFromRef(reference);
      return position && isSpreadsheetFormulaArray(value)
        ? position.row + Math.max(1, value.height)
        : 0;
    }),
  );
  const requiredColumns = Math.max(
    xlsxColumnCount(sheet),
    ...spillResults.map(({ reference, value }) => {
      const position = xlsxCellPositionFromRef(reference);
      return position && isSpreadsheetFormulaArray(value)
        ? position.column + Math.max(1, value.width)
        : 0;
    }),
  );
  const rows = ensureXlsxRows(sheet, requiredRows, requiredColumns);

  for (const { reference, value } of spillResults) {
    if (!isSpreadsheetFormulaArray(value)) continue;
    const anchor = xlsxCellPositionFromRef(reference);
    if (!anchor) continue;
    const width = Math.max(1, value.width);
    const height = Math.max(1, value.height, Math.ceil(value.values.length / width));
    const spillRange = {
      top: anchor.row,
      left: anchor.column,
      bottom: anchor.row + height - 1,
      right: anchor.column + width - 1,
    };
    if (xlsxSpillRangeBlocked(rows, spillRange, reference)) {
      const anchorCell = rows[anchor.row]?.cells[anchor.column];
      if (anchorCell) {
        rows[anchor.row].cells[anchor.column] = {
          ...anchorCell,
          value: "#SPILL!",
          spillRange: rangeToA1(spillRange),
        };
      }
      continue;
    }

    const anchorCell = rows[anchor.row]?.cells[anchor.column];
    if (anchorCell) {
      rows[anchor.row].cells[anchor.column] = {
        ...anchorCell,
        value: formatFormulaValueForCell(value),
        spillRange: rangeToA1(spillRange),
      };
    }
    for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) continue;
        const targetRow = anchor.row + rowOffset;
        const targetColumn = anchor.column + columnOffset;
        const targetCell = rows[targetRow]?.cells[targetColumn];
        if (!targetCell) continue;
        const valueIndex = rowOffset * width + columnOffset;
        rows[targetRow].cells[targetColumn] = {
          ...targetCell,
          value: formatFormulaValueForCell(value.values[valueIndex] ?? ""),
          formula: undefined,
          generated: "spill",
          spillParent: reference,
          spillRange: rangeToA1(spillRange),
        };
      }
    }
  }

  return { ...sheet, rows };
}

function xlsxSpillRangeBlocked(
  rows: XlsxRow[],
  range: NormalizedCellRange,
  anchorReference: string,
) {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = rows[row]?.cells[column];
      if (!cell || normalizeFormulaRef(cell.ref) === normalizeFormulaRef(anchorReference)) {
        continue;
      }
      if (cell.generated === "spill") {
        if (normalizeFormulaRef(cell.spillParent ?? "") === normalizeFormulaRef(anchorReference)) {
          continue;
        }
        return true;
      }
      if (cell.formula || cell.value !== "") return true;
    }
  }
  return false;
}

function normalizeFormulaRef(reference: string) {
  return reference
    .slice(reference.lastIndexOf("!") + 1)
    .replace(/\$/g, "")
    .toUpperCase();
}

function xlsxFormulaReferenceSheetName(reference: string) {
  const separator = reference.lastIndexOf("!");
  if (separator < 0) return null;
  const raw = reference.slice(0, separator);
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function referencesForRange(startRef: string, endRef: string) {
  const start = xlsxRangeFromRef(normalizeFormulaRef(startRef));
  const end = xlsxRangeFromRef(normalizeFormulaRef(endRef));
  if (!start || !end) return [];
  const top = Math.min(start.top, end.top);
  const bottom = Math.max(start.bottom, end.bottom);
  const left = Math.min(start.left, end.left);
  const right = Math.max(start.right, end.right);
  return rangeReferences({ top, right, bottom, left });
}

function rangeReferences(range: NormalizedCellRange) {
  const references: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      references.push(`${columnName(column)}${row + 1}`);
    }
  }
  return references;
}
