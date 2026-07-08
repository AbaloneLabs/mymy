export type SpreadsheetFormulaScalar = number | string | boolean;

export interface SpreadsheetFormulaArray {
  kind: "array";
  values: SpreadsheetFormulaScalar[];
  width: number;
  height: number;
}

export type SpreadsheetFormulaValue =
  | SpreadsheetFormulaScalar
  | SpreadsheetFormulaArray;

export function spreadsheetFormulaValueNumber(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  const scalar = spreadsheetFormulaFirstScalar(value);
  if (scalar !== value) return spreadsheetFormulaValueNumber(scalar);
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value ?? "");
  return Number.isFinite(number) ? number : 0;
}

export function spreadsheetFormulaValueBoolean(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  const scalar = spreadsheetFormulaFirstScalar(value);
  if (scalar !== value) return spreadsheetFormulaValueBoolean(scalar);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && Number.isFinite(value);
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return false;
  if (normalized === "FALSE") return false;
  if (normalized === "TRUE") return true;
  const number = Number(normalized);
  return Number.isFinite(number) ? number !== 0 : true;
}

export function formatSpreadsheetFormulaResult(value: SpreadsheetFormulaValue) {
  if (isSpreadsheetFormulaArray(value)) {
    return formatSpreadsheetFormulaResult(value.values[0] ?? "");
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(12)).toString();
}

export function spreadsheetFormulaValueText(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  const scalar = spreadsheetFormulaFirstScalar(value);
  if (scalar !== value) return spreadsheetFormulaValueText(scalar);
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function spreadsheetFormulaFirstError(values: SpreadsheetFormulaValue[]) {
  return spreadsheetFormulaFlattenValues(values).find(
    (value): value is string =>
      typeof value === "string" &&
      /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)$/i.test(
        value,
      ),
  );
}

export function isSpreadsheetFormulaArray(
  value: SpreadsheetFormulaValue | string | undefined,
): value is SpreadsheetFormulaArray {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "array"
  );
}

export function spreadsheetFormulaArray(
  values: SpreadsheetFormulaValue[],
  width: number,
  height: number,
): SpreadsheetFormulaArray {
  return {
    kind: "array",
    values: spreadsheetFormulaFlattenValues(values),
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function spreadsheetFormulaFlattenValues(
  values: SpreadsheetFormulaValue[],
) {
  return values.flatMap((value) =>
    isSpreadsheetFormulaArray(value) ? value.values : [value],
  );
}

export function spreadsheetFormulaFirstScalar(
  value: SpreadsheetFormulaValue | string | undefined,
): SpreadsheetFormulaScalar | string | undefined {
  return isSpreadsheetFormulaArray(value) ? (value.values[0] ?? "") : value;
}

export function isSpreadsheetFormulaError(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  return typeof value === "string" && spreadsheetFormulaFirstError([value]) === value;
}

export function isSpreadsheetFormulaNa(
  value: SpreadsheetFormulaValue | string | undefined,
) {
  return typeof value === "string" && value.toUpperCase() === "#N/A";
}

export function compareSpreadsheetFormulaValues(
  left: SpreadsheetFormulaValue,
  right: SpreadsheetFormulaValue,
  operator: string,
) {
  const error = spreadsheetFormulaFirstError([left, right]);
  if (error) return error;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const comparable =
    Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : spreadsheetFormulaValueText(left).localeCompare(
          spreadsheetFormulaValueText(right),
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          },
        );
  if (operator === "=") return comparable === 0;
  if (operator === "<>") return comparable !== 0;
  if (operator === "<") return comparable < 0;
  if (operator === "<=") return comparable <= 0;
  if (operator === ">") return comparable > 0;
  if (operator === ">=") return comparable >= 0;
  return false;
}

export function spreadsheetFormulaAsArray(
  value: SpreadsheetFormulaValue | undefined,
) {
  if (isSpreadsheetFormulaArray(value)) return value;
  if (value === undefined) return null;
  return spreadsheetFormulaArray([value], 1, 1);
}

export function spreadsheetFormulaValuesEqual(
  left: SpreadsheetFormulaValue,
  right: SpreadsheetFormulaValue,
) {
  return compareSpreadsheetFormulaValues(left, right, "=") === true;
}

export function wildcardSpreadsheetFormulaPattern(value: string) {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`, "i");
}
