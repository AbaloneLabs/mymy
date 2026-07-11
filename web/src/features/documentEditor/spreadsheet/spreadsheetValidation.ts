import { xlsxDefinedNameTarget } from "./spreadsheetDefinedNames";
import { xlsxSqrefRanges } from "./spreadsheetXlsxMetadata";
import type {
  XlsxDataValidation,
  XlsxModel,
  XlsxSheet,
} from "../shared/models";

export type XlsxInputValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validate raw input before any workbook mutation. Paste and fill call the
 * same function and reject their whole matrix on the first invalid target, so
 * a multi-cell operation cannot leave a partially applied result. Validation
 * forms that cannot be evaluated faithfully are blocked with an explicit
 * reason instead of being presented as enforced metadata.
 */
export function validateXlsxCellInput(
  model: XlsxModel,
  sheet: XlsxSheet,
  row: number,
  column: number,
  value: string,
): XlsxInputValidationResult {
  const validation = validationForCell(sheet.dataValidations, row, column);
  if (!validation || validation.showErrorMessage === false) return { valid: true };
  if (value === "") {
    return validation.allowBlank !== false
      ? { valid: true }
      : invalid(validation, "Blank values are not allowed");
  }
  if (value.startsWith("=")) {
    return invalid(
      validation,
      "Formula-result validation is not available for this rule, so the edit was blocked",
    );
  }
  if (validation.type === "list") {
    const allowed = validationListValues(model, sheet, validation.formula1);
    if (!allowed) {
      return invalid(validation, "The validation list source cannot be evaluated safely");
    }
    return allowed.includes(value)
      ? { valid: true }
      : invalid(validation, `Choose one of ${allowed.length} allowed values`);
  }
  if (validation.type === "custom") {
    return invalid(validation, "Custom validation formulas are preservation-only");
  }

  const compared = validation.type === "textLength" ? value.length : Number(value);
  if (!Number.isFinite(compared)) {
    return invalid(validation, validationTypeMessage(validation.type));
  }
  if (validation.type === "whole" && !Number.isInteger(compared)) {
    return invalid(validation, "Enter a whole number");
  }
  const first = validationThreshold(validation.formula1);
  const second = validationThreshold(validation.formula2);
  if (first === null) {
    return invalid(validation, "The validation threshold cannot be evaluated safely");
  }
  const operator = validation.operator ?? "between";
  const valid = compareValidationValue(compared, operator, first, second);
  return valid ? { valid: true } : invalid(validation, "The value is outside the allowed range");
}

function validationForCell(
  validations: XlsxDataValidation[] | undefined,
  row: number,
  column: number,
) {
  return validations?.find((validation) =>
    xlsxSqrefRanges(validation.sqref).some(
      (range) =>
        row >= range.top &&
        row <= range.bottom &&
        column >= range.left &&
        column <= range.right,
    ),
  );
}

function validationListValues(
  model: XlsxModel,
  activeSheet: XlsxSheet,
  formula: string | undefined,
) {
  const source = formula?.trim();
  if (!source) return null;
  if (source.startsWith('"') && source.endsWith('"')) {
    return source.slice(1, -1).split(",").map((value) => value.trim());
  }
  if (source.includes(",") && !source.includes("!")) {
    return source.split(",").map((value) => value.trim());
  }
  const target = xlsxDefinedNameTarget(source);
  if (!target) return null;
  const sheet = target.sheetName
    ? model.sheets.find((candidate) => candidate.name === target.sheetName)
    : activeSheet;
  if (!sheet) return null;
  const values: string[] = [];
  for (let row = target.range.top; row <= target.range.bottom; row += 1) {
    for (let column = target.range.left; column <= target.range.right; column += 1) {
      values.push(sheet.rows[row]?.cells[column]?.value ?? "");
    }
  }
  return values;
}

function validationThreshold(formula: string | undefined) {
  if (!formula?.trim()) return null;
  const value = Number(formula.replace(/^=/, "").trim());
  return Number.isFinite(value) ? value : null;
}

function compareValidationValue(
  value: number,
  operator: NonNullable<XlsxDataValidation["operator"]>,
  first: number,
  second: number | null,
) {
  switch (operator) {
    case "between":
      return second !== null && value >= first && value <= second;
    case "notBetween":
      return second !== null && (value < first || value > second);
    case "equal":
      return value === first;
    case "notEqual":
      return value !== first;
    case "greaterThan":
      return value > first;
    case "lessThan":
      return value < first;
    case "greaterThanOrEqual":
      return value >= first;
    case "lessThanOrEqual":
      return value <= first;
  }
}

function validationTypeMessage(type: XlsxDataValidation["type"]) {
  if (type === "textLength") return "Enter text whose length satisfies the rule";
  if (type === "date") return "Enter an Excel date serial number";
  if (type === "time") return "Enter an Excel time serial number";
  return "Enter a numeric value";
}

function invalid(
  validation: XlsxDataValidation,
  fallback: string,
): XlsxInputValidationResult {
  return {
    valid: false,
    reason: [validation.errorTitle, validation.error].filter(Boolean).join(": ") || fallback,
  };
}
