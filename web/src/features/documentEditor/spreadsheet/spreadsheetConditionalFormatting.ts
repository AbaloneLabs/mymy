import { evaluateSpreadsheetFormula } from "./spreadsheetFormulaParser";
import {
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
} from "./spreadsheetFormulaValues";
import {
  xlsxCellPositionFromRef,
  type NormalizedCellRange,
} from "./spreadsheetGeometry";
import { xlsxSqrefRanges } from "./spreadsheetXlsxMetadata";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type {
  XlsxCell,
  XlsxConditionalFormatting,
  XlsxConditionalRule,
  XlsxSheet,
} from "../shared/models";

export function xlsxConditionalCellStyle(
  formattings: XlsxConditionalFormatting[] | undefined,
  sheet: XlsxSheet | undefined,
  row: number,
  column: number,
  cell: XlsxCell,
  columnCount: number,
) {
  if (!formattings || !sheet) return {};
  for (const formatting of formattings) {
    const ranges = xlsxSqrefRanges(formatting.sqref);
    const inRange = ranges.some((range) => rangeContainsCell(range, row, column));
    if (!inRange) continue;
    for (const rule of formatting.rules) {
      if (!rule.fillColor) continue;
      if (
        xlsxConditionalRuleMatches(
          rule,
          formatting,
          sheet,
          row,
          column,
          cell,
          columnCount,
        )
      ) {
        return { backgroundColor: rule.fillColor };
      }
    }
  }
  return {};
}

function xlsxConditionalRuleMatches(
  rule: XlsxConditionalRule,
  formatting: XlsxConditionalFormatting,
  sheet: XlsxSheet,
  row: number,
  column: number,
  cell: XlsxCell,
  columnCount: number,
) {
  const value = displayXlsxCellValue(cell);
  if (rule.type === "cellIs") {
    return compareConditionalCellValue(value, rule.operator, rule.formulas ?? []);
  }
  if (rule.type === "containsText") {
    const text = (rule.text ?? rule.formulas?.[0] ?? "").toLowerCase();
    return text ? value.toLowerCase().includes(text) : false;
  }
  if (rule.type === "duplicateValues") {
    if (!value) return false;
    const values = xlsxValuesForSqref(sheet, columnCount, formatting.sqref);
    return values.filter((item) => item === value).length > 1;
  }
  if (rule.type === "blanks") return value.trim() === "";
  if (rule.type === "errors") {
    return /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CYCLE!)$/i.test(value);
  }
  if (rule.type === "expression") {
    const formula = rule.formulas?.[0]?.trim();
    if (!formula) return false;
    return evaluateConditionalFormula(sheet, columnCount, formula, row, column);
  }
  return false;
}

function compareConditionalCellValue(
  value: string,
  operator: XlsxConditionalRule["operator"],
  formulas: string[],
) {
  const leftNumber = Number(value);
  const first = formulas[0] ?? "";
  const second = formulas[1] ?? "";
  const rightNumber = Number(first);
  const secondNumber = Number(second);
  const numeric =
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    (second === "" || Number.isFinite(secondNumber));
  const compare = numeric
    ? leftNumber - rightNumber
    : value.localeCompare(first, undefined, {
        numeric: true,
        sensitivity: "base",
      });
  switch (operator) {
    case "lessThan":
      return compare < 0;
    case "lessThanOrEqual":
      return compare <= 0;
    case "equal":
      return compare === 0;
    case "notEqual":
      return compare !== 0;
    case "greaterThanOrEqual":
      return compare >= 0;
    case "between":
      return numeric
        ? leftNumber >= rightNumber && leftNumber <= secondNumber
        : value >= first && value <= second;
    case "notBetween":
      return numeric
        ? leftNumber < rightNumber || leftNumber > secondNumber
        : value < first || value > second;
    case "greaterThan":
    default:
      return compare > 0;
  }
}

function evaluateConditionalFormula(
  sheet: XlsxSheet,
  columnCount: number,
  formula: string,
  row: number,
  column: number,
) {
  try {
    const expression = formula
      .replace(/^=/, "")
      .replace(/\b([A-Z]+)(\d+)\b/gi, (reference) =>
        adjustFormulaReferenceForConditionalRule(reference, row, column),
      );
    const comparison = /^(.+?)(>=|<=|<>|=|>|<)(.+)$/.exec(expression);
    if (comparison) {
      const left = evaluateConditionalFormulaOperand(
        sheet,
        columnCount,
        comparison[1],
      );
      const right = evaluateConditionalFormulaOperand(
        sheet,
        columnCount,
        comparison[3],
      );
      switch (comparison[2]) {
        case ">=":
          return left >= right;
        case "<=":
          return left <= right;
        case "<>":
          return left !== right;
        case "=":
          return left === right;
        case ">":
          return left > right;
        case "<":
          return left < right;
        default:
          return false;
      }
    }
    const result = evaluateSpreadsheetFormula(expression, (reference) =>
      xlsxDisplayValueForRef(sheet, columnCount, reference),
    );
    return spreadsheetFormulaValueBoolean(result);
  } catch {
    return false;
  }
}

function evaluateConditionalFormulaOperand(
  sheet: XlsxSheet,
  columnCount: number,
  expression: string,
) {
  const result = evaluateSpreadsheetFormula(expression, (reference) =>
    xlsxDisplayValueForRef(sheet, columnCount, reference),
  );
  return spreadsheetFormulaValueNumber(result);
}

function adjustFormulaReferenceForConditionalRule(
  reference: string,
  row: number,
  column: number,
) {
  const position = xlsxCellPositionFromRef(reference);
  if (!position) return reference;
  return `${columnName(position.column + column)}${position.row + row + 1}`;
}

function xlsxDisplayValueForRef(
  sheet: XlsxSheet,
  columnCount: number,
  reference: string,
) {
  const position = xlsxCellPositionFromRef(reference);
  if (!position) return "";
  const row = sheet.rows[position.row];
  if (!row) return "";
  const cell = normalizeXlsxCells(
    row.cells,
    columnCount,
    row.index || String(position.row + 1),
  )[position.column];
  return displayXlsxCellValue(cell);
}

function xlsxValuesForSqref(
  sheet: XlsxSheet,
  columnCount: number,
  sqref: string,
) {
  return xlsxSqrefRanges(sqref).flatMap((range) =>
    valuesFromXlsxRange(sheet, columnCount, range).flat(),
  );
}

function valuesFromXlsxRange(
  sheet: XlsxSheet,
  columnCount: number,
  range: NormalizedCellRange,
) {
  return sheet.rows.slice(range.top, range.bottom + 1).map((row, rowOffset) =>
    normalizeXlsxCells(
      row.cells,
      columnCount,
      row.index || String(range.top + rowOffset + 1),
    )
      .slice(range.left, range.right + 1)
      .map((cell) => displayXlsxCellValue(cell)),
  );
}

function displayXlsxCellValue(cell?: XlsxCell) {
  if (!cell) return "";
  return cell.value;
}

function rangeContainsCell(range: NormalizedCellRange, row: number, column: number) {
  return (
    row >= range.top &&
    row <= range.bottom &&
    column >= range.left &&
    column <= range.right
  );
}
