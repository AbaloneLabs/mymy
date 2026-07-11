import { columnName } from "../shared/models";
import { tokenizeSpreadsheetFormula } from "./spreadsheetFormulaTokens";

export type SpreadsheetStructuralEdit = {
  axis: "row" | "column";
  kind: "insert" | "delete";
  index: number;
};

const FORMULA_REFERENCE_PATTERN =
  /(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Za-z]{1,3}\$?\d+)?/g;

export function adjustSpreadsheetFormulaReferences(
  formula: string,
  rowOffset: number,
  columnOffset: number,
) {
  return formula.replace(
    /'(?:[^']|'')+'!\$?[A-Za-z]{1,3}\$?\d+|[A-Za-z_][A-Za-z0-9_.]*!\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}\$?\d+/g,
    (match, offset: number, source: string) => {
      if (spreadsheetFormulaReferenceIsProtected(source, offset, match.length)) {
        return match;
      }
      return adjustSpreadsheetFormulaReferenceToken(
        match,
        rowOffset,
        columnOffset,
      );
    },
  );
}

/**
 * Structural edits differ from copy/fill offsets: absolute references move as
 * rows and columns are inserted, ranges shrink rather than becoming a partial
 * `#REF!`, and unqualified references belong to the formula's own sheet. This
 * transformer keeps those rules in one place for cells, validations, charts,
 * and other formula owners.
 */
export function transformSpreadsheetFormulaForStructuralEdit(
  formula: string,
  formulaSheetName: string,
  targetSheetName: string,
  edit: SpreadsheetStructuralEdit,
) {
  return formula.replace(
    FORMULA_REFERENCE_PATTERN,
    (matched, offset: number, source: string) => {
      if (
        spreadsheetFormulaReferenceIsProtected(source, offset, matched.length)
      ) {
        return matched;
      }
      const separator = matched.indexOf(":");
      const start = parseFormulaCellReference(
        separator >= 0 ? matched.slice(0, separator) : matched,
      );
      const end =
        separator >= 0
          ? parseFormulaCellReference(matched.slice(separator + 1))
          : null;
      if (!start || (separator >= 0 && !end)) return matched;
      const startSheet = start.sheetName ?? formulaSheetName;
      const endSheet = end?.sheetName ?? start.sheetName ?? formulaSheetName;
      const startApplies = startSheet === targetSheetName;
      const endApplies = Boolean(end && endSheet === targetSheetName);
      if (!startApplies && !endApplies) return matched;

      if (end && startApplies && endApplies) {
        return transformFormulaRange(start, end, edit);
      }
      const transformedStart = startApplies
        ? transformFormulaCell(start, edit)
        : formatFormulaCellReference(start);
      const transformedEnd = end
        ? endApplies
          ? transformFormulaCell(end, edit)
          : formatFormulaCellReference(end)
        : null;
      return transformedEnd === null
        ? transformedStart
        : `${transformedStart}:${transformedEnd}`;
    },
  );
}

export function renameSpreadsheetFormulaSheetReferences(
  formula: string,
  oldName: string,
  nextName: string,
) {
  return formula.replace(
    FORMULA_REFERENCE_PATTERN,
    (matched, offset: number, source: string) => {
      if (
        spreadsheetFormulaReferenceIsProtected(source, offset, matched.length)
      ) {
        return matched;
      }
      const separator = matched.indexOf(":");
      const parts =
        separator >= 0
          ? [matched.slice(0, separator), matched.slice(separator + 1)]
          : [matched];
      return parts
        .map((part) => {
          const reference = parseFormulaCellReference(part);
          if (!reference || reference.sheetName !== oldName) return part;
          return formatFormulaCellReference({
            ...reference,
            prefix: `${quoteSpreadsheetSheetName(nextName)}!`,
            sheetName: nextName,
          });
        })
        .join(":");
    },
  );
}

export function invalidateSpreadsheetFormulaSheetReferences(
  formula: string,
  deletedSheetName: string,
) {
  return formula.replace(
    FORMULA_REFERENCE_PATTERN,
    (matched, offset: number, source: string) => {
      if (
        spreadsheetFormulaReferenceIsProtected(source, offset, matched.length)
      ) {
        return matched;
      }
      const parts = matched.includes(":") ? matched.split(":") : [matched];
      return parts.some(
        (part) => parseFormulaCellReference(part)?.sheetName === deletedSheetName,
      )
        ? "#REF!"
        : matched;
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
        spreadsheetFormulaRangeReferences(token.value, end.value).forEach(
          (reference) => references.add(reference),
        );
        index += 2;
        continue;
      }
      if (
        token.type === "identifier" &&
        isSpreadsheetFormulaCellReference(token.value)
      ) {
        references.add(displaySpreadsheetFormulaRef(token.value));
        continue;
      }
      if (token.type === "structuredReference") {
        options
          ?.referencesForStructuredReference?.(token.value)
          .forEach((reference) => references.add(reference));
        continue;
      }
      if (
        token.type === "identifier" &&
        !(
          tokens[index + 1]?.type === "operator" &&
          tokens[index + 1]?.value === "("
        ) &&
        !isSpreadsheetFormulaCellReference(token.value)
      ) {
        options
          ?.referencesForName?.(token.value)
          .forEach((reference) => references.add(reference));
      }
    }
    return [...references].sort(compareSpreadsheetFormulaRefs);
  } catch {
    return [];
  }
}

export function spreadsheetFormulaRangeReferences(
  startRef: string,
  endRef: string,
) {
  const start = spreadsheetFormulaReferencePosition(startRef);
  const end = spreadsheetFormulaReferencePosition(endRef);
  if (!start || !end) return [];
  const prefix =
    formulaReferenceSheetPrefix(startRef) ??
    formulaReferenceSheetPrefix(endRef) ??
    "";
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

export function spreadsheetFormulaRangeDimensions(
  startRef: string,
  endRef: string,
) {
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
  const nextRow = rowLock ? Number(row) : Math.max(1, Number(row) + rowOffset);
  return `${prefix}${columnLock}${columnName(nextColumnIndex)}${rowLock}${nextRow}`;
}

function spreadsheetFormulaReferencePosition(reference: string) {
  const match = /^([A-Z]+)(\d+)$/i.exec(
    normalizeSpreadsheetFormulaRef(reference),
  );
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
  return (
    name
      .toUpperCase()
      .split("")
      .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1
  );
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

type ParsedFormulaCellReference = {
  prefix: string;
  sheetName: string | null;
  columnAbsolute: boolean;
  column: number;
  rowAbsolute: boolean;
  row: number;
};

function parseFormulaCellReference(
  value: string,
): ParsedFormulaCellReference | null {
  const separator = value.lastIndexOf("!");
  const prefix = separator >= 0 ? value.slice(0, separator + 1) : "";
  const body = separator >= 0 ? value.slice(separator + 1) : value;
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(body);
  if (!match) return null;
  return {
    prefix,
    sheetName: prefix ? spreadsheetSheetNameFromPrefix(prefix) : null,
    columnAbsolute: match[1] === "$",
    column: columnIndexFromName(match[2]),
    rowAbsolute: match[3] === "$",
    row: Math.max(0, Number(match[4]) - 1),
  };
}

function transformFormulaRange(
  start: ParsedFormulaCellReference,
  end: ParsedFormulaCellReference,
  edit: SpreadsheetStructuralEdit,
) {
  const startCoordinate = edit.axis === "row" ? start.row : start.column;
  const endCoordinate = edit.axis === "row" ? end.row : end.column;
  if (edit.kind === "insert") {
    return `${formatFormulaCellReference(
      transformParsedFormulaCell(start, edit) ?? start,
    )}:${formatFormulaCellReference(transformParsedFormulaCell(end, edit) ?? end)}`;
  }
  const low = Math.min(startCoordinate, endCoordinate);
  const high = Math.max(startCoordinate, endCoordinate);
  if (edit.index < low) {
    return `${formatFormulaCellReference(
      transformParsedFormulaCell(start, edit) ?? start,
    )}:${formatFormulaCellReference(transformParsedFormulaCell(end, edit) ?? end)}`;
  }
  if (edit.index > high) {
    return `${formatFormulaCellReference(start)}:${formatFormulaCellReference(end)}`;
  }
  if (low === high) return `${start.prefix}#REF!`;
  const nextLow = low;
  const nextHigh = high - 1;
  const startIsLow = startCoordinate <= endCoordinate;
  return `${formatFormulaCellReference(
    withFormulaCoordinate(start, edit.axis, startIsLow ? nextLow : nextHigh),
  )}:${formatFormulaCellReference(
    withFormulaCoordinate(end, edit.axis, startIsLow ? nextHigh : nextLow),
  )}`;
}

function transformFormulaCell(
  reference: ParsedFormulaCellReference,
  edit: SpreadsheetStructuralEdit,
) {
  const transformed = transformParsedFormulaCell(reference, edit);
  if (transformed === null) return `${reference.prefix}#REF!`;
  return formatFormulaCellReference(transformed);
}

function transformParsedFormulaCell(
  reference: ParsedFormulaCellReference,
  edit: SpreadsheetStructuralEdit,
) {
  const coordinate = edit.axis === "row" ? reference.row : reference.column;
  if (edit.kind === "delete" && coordinate === edit.index) return null;
  const delta =
    edit.kind === "insert"
      ? coordinate >= edit.index
        ? 1
        : 0
      : coordinate > edit.index
        ? -1
        : 0;
  return withFormulaCoordinate(reference, edit.axis, coordinate + delta);
}

function withFormulaCoordinate(
  reference: ParsedFormulaCellReference,
  axis: SpreadsheetStructuralEdit["axis"],
  coordinate: number,
) {
  return axis === "row"
    ? { ...reference, row: coordinate }
    : { ...reference, column: coordinate };
}

function formatFormulaCellReference(reference: ParsedFormulaCellReference) {
  return `${reference.prefix}${reference.columnAbsolute ? "$" : ""}${columnName(
    reference.column,
  )}${reference.rowAbsolute ? "$" : ""}${reference.row + 1}`;
}

function spreadsheetSheetNameFromPrefix(prefix: string) {
  const raw = prefix.slice(0, -1);
  return raw.startsWith("'") && raw.endsWith("'")
    ? raw.slice(1, -1).replace(/''/g, "'")
    : raw;
}

function quoteSpreadsheetSheetName(sheetName: string) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName)
    ? sheetName
    : `'${sheetName.replace(/'/g, "''")}'`;
}

function spreadsheetFormulaReferenceIsProtected(
  source: string,
  offset: number,
  length: number,
) {
  let inString = false;
  let structuredDepth = 0;
  for (let index = 0; index < offset; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (inString && source[index + 1] === '"') index += 1;
      else inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "[") structuredDepth += 1;
    if (character === "]") structuredDepth = Math.max(0, structuredDepth - 1);
  }
  if (inString || structuredDepth > 0) return true;
  const before = source[offset - 1] ?? "";
  const after = source[offset + length] ?? "";
  if (/[A-Za-z0-9_.$]/.test(before) || /[A-Za-z0-9_.$[]/.test(after)) {
    return true;
  }
  return after === "(";
}
