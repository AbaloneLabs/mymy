import { columnName } from "../shared/models";
import { tokenizeSpreadsheetFormula } from "./spreadsheetFormulaTokens";

export function adjustSpreadsheetFormulaReferences(
  formula: string,
  rowOffset: number,
  columnOffset: number,
) {
  return formula.replace(
    /'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?\d+|[A-Za-z_][A-Za-z0-9_.]*!\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}\$?\d+/g,
    (match, offset: number, source: string) => {
      if (
        spreadsheetFormulaReferenceInsideStructuredReference(source, offset) ||
        spreadsheetFormulaReferenceInsideIdentifier(source, offset, match.length)
      ) {
        return match;
      }
      return adjustSpreadsheetFormulaReferenceToken(match, rowOffset, columnOffset);
    },
  );
}

export function spreadsheetFormulaReferences(
  formula: string,
  options?: {
    referencesForName?: (name: string) => string[];
    referencesForStructuredReference?: (reference: string) => string[];
  },
) {
  try {
    const tokens = tokenizeSpreadsheetFormula(formula);
    const references = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const colon = tokens[index + 1];
      const end = tokens[index + 2];
      if (
        token.type === "identifier" &&
        colon?.type === "operator" &&
        colon.value === ":" &&
        end?.type === "identifier" &&
        isSpreadsheetFormulaCellReference(token.value) &&
        isSpreadsheetFormulaCellReference(end.value)
      ) {
        spreadsheetFormulaRangeReferences(token.value, end.value).forEach((reference) =>
          references.add(reference),
        );
        index += 2;
        continue;
      }
      if (token.type === "identifier" && isSpreadsheetFormulaCellReference(token.value)) {
        references.add(displaySpreadsheetFormulaRef(token.value));
        continue;
      }
      if (token.type === "structuredReference") {
        options?.referencesForStructuredReference?.(token.value).forEach((reference) =>
          references.add(reference),
        );
        continue;
      }
      if (
        token.type === "identifier" &&
        !(tokens[index + 1]?.type === "operator" && tokens[index + 1]?.value === "(") &&
        !isSpreadsheetFormulaCellReference(token.value)
      ) {
        options?.referencesForName?.(token.value).forEach((reference) =>
          references.add(reference),
        );
      }
    }
    return [...references].sort(compareSpreadsheetFormulaRefs);
  } catch {
    return [];
  }
}

export function spreadsheetFormulaRangeReferences(startRef: string, endRef: string) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return [];
  const prefix = formulaReferenceSheetPrefix(startRef) ?? formulaReferenceSheetPrefix(endRef) ?? "";
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const references: string[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      references.push(`${prefix}${columnName(column)}${row + 1}`);
    }
  }
  return references;
}

export function spreadsheetFormulaRangeDimensions(startRef: string, endRef: string) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return null;
  return {
    width: Math.abs(end.column - start.column) + 1,
    height: Math.abs(end.row - start.row) + 1,
  };
}

export function isSpreadsheetFormulaCellReference(value: string) {
  return /^[A-Z]+\d+$/i.test(normalizeSpreadsheetFormulaRef(value));
}

function adjustSpreadsheetFormulaReferenceToken(
  reference: string,
  rowOffset: number,
  columnOffset: number,
) {
  const separator = reference.lastIndexOf("!");
  const prefix = separator >= 0 ? reference.slice(0, separator + 1) : "";
  const body = separator >= 0 ? reference.slice(separator + 1) : reference;
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(body);
  if (!match) return reference;
  const [, columnLock, column, rowLock, row] = match;
  const nextColumnIndex = columnLock
    ? columnIndexFromName(column)
    : Math.max(0, columnIndexFromName(column) + columnOffset);
  const nextRow = rowLock
    ? Number(row)
    : Math.max(1, Number(row) + rowOffset);
  return `${prefix}${columnLock}${columnName(nextColumnIndex)}${rowLock}${nextRow}`;
}

function spreadsheetFormulaReferenceInsideStructuredReference(
  source: string,
  offset: number,
) {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < offset; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (inString && source[index + 1] === '"') {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function spreadsheetFormulaReferenceInsideIdentifier(
  source: string,
  offset: number,
  length: number,
) {
  const before = source[offset - 1] ?? "";
  const after = source[offset + length] ?? "";
  return /[A-Za-z0-9_.$]/.test(before) || /[A-Za-z0-9_.$[]/.test(after);
}

function spreadsheetFormulaReferencePosition(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(normalizeSpreadsheetFormulaRef(reference));
  if (!match) return null;
  return {
    row: Math.max(0, Number(match[2]) - 1),
    column: columnIndexFromName(match[1]),
  };
}

function normalizeSpreadsheetFormulaRef(reference: string) {
  return formulaReferenceBody(reference).replace(/\$/g, "").toUpperCase();
}

function displaySpreadsheetFormulaRef(reference: string) {
  return `${formulaReferenceSheetPrefix(reference) ?? ""}${normalizeSpreadsheetFormulaRef(reference)}`;
}

function formulaReferenceSheetPrefix(reference: string) {
  const separator = reference.lastIndexOf("!");
  if (separator < 0) return null;
  return reference.slice(0, separator + 1);
}

function formulaReferenceBody(reference: string) {
  return reference.slice(reference.lastIndexOf("!") + 1);
}

function columnIndexFromName(name: string) {
  return name
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function compareSpreadsheetFormulaRefs(left: string, right: string) {
  const leftPosition = spreadsheetFormulaReferencePosition(left);
  const rightPosition = spreadsheetFormulaReferencePosition(right);
  if (!leftPosition || !rightPosition) return left.localeCompare(right);
  return (
    leftPosition.row - rightPosition.row ||
    leftPosition.column - rightPosition.column
  );
}
