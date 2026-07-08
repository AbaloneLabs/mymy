import { columnName } from "../shared/models";
import type { XlsxSheet, XlsxTable } from "../shared/models";
import type { NormalizedCellRange } from "./spreadsheetGeometry";
import {
  xlsxCellPositionFromRef,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";

export interface XlsxStructuredReferenceResolution {
  height: number;
  references: string[];
  sheet: XlsxSheet;
  width: number;
}

interface XlsxStructuredReferenceContext {
  currentCellReference?: string;
  currentSheet: XlsxSheet;
  sheets: XlsxSheet[];
}

interface ParsedStructuredReference {
  columns: string[];
  includeAll: boolean;
  includeData: boolean;
  includeHeaders: boolean;
  includeThisRow: boolean;
  includeTotals: boolean;
  tableName?: string;
}

export function xlsxStructuredReferenceRange(
  reference: string,
  context: XlsxStructuredReferenceContext,
): XlsxStructuredReferenceResolution | null {
  const parsed = parseStructuredReference(reference);
  if (!parsed) return null;
  const target = structuredReferenceTable(parsed, context);
  if (!target) return null;
  const tableRange = target.table.ref ? xlsxRangeFromRef(target.table.ref) : null;
  if (!tableRange) return null;
  const columnRange = structuredReferenceColumnRange(parsed, target.table, tableRange);
  if (!columnRange) return null;
  const rowRange = structuredReferenceRowRange(
    parsed,
    target.table,
    tableRange,
    context.currentCellReference,
  );
  if (!rowRange) return null;
  const range = {
    top: rowRange.top,
    right: columnRange.right,
    bottom: rowRange.bottom,
    left: columnRange.left,
  };
  return {
    sheet: target.sheet,
    references: structuredReferenceRangeReferences(range),
    width: Math.max(0, range.right - range.left + 1),
    height: Math.max(0, range.bottom - range.top + 1),
  };
}

export function xlsxStructuredReferenceReferences(
  reference: string,
  context: XlsxStructuredReferenceContext,
) {
  const resolved = xlsxStructuredReferenceRange(reference, context);
  if (!resolved) return [];
  const prefix =
    resolved.sheet.id === context.currentSheet.id
      ? ""
      : `${quoteFormulaSheetName(resolved.sheet.name)}!`;
  return resolved.references.map((item) => `${prefix}${item}`);
}

function parseStructuredReference(value: string): ParsedStructuredReference | null {
  const firstBracket = value.indexOf("[");
  if (firstBracket < 0 || !value.endsWith("]")) return null;
  const tableName = firstBracket > 0 ? value.slice(0, firstBracket) : undefined;
  const body = value.slice(firstBracket);
  const inner = stripOuterBrackets(body);
  if (inner === null) return null;
  const sections = splitStructuredReferenceSections(inner)
    .map((section) => stripOuterBrackets(section) ?? section)
    .map((section) => section.trim())
    .filter(Boolean);
  const parsed: ParsedStructuredReference = {
    columns: [],
    includeAll: false,
    includeData: false,
    includeHeaders: false,
    includeThisRow: false,
    includeTotals: false,
    tableName,
  };
  const range = structuredReferenceColumnRangeSections(inner);
  if (range) {
    parsed.columns = range;
  }
  for (const section of sections) {
    const normalized = section.toLowerCase();
    if (normalized === "#all") parsed.includeAll = true;
    else if (normalized === "#data") parsed.includeData = true;
    else if (normalized === "#headers") parsed.includeHeaders = true;
    else if (normalized === "#totals") parsed.includeTotals = true;
    else if (normalized === "#this row") parsed.includeThisRow = true;
    else if (section.startsWith("@")) {
      parsed.includeThisRow = true;
      const column = section.slice(1).trim();
      if (column) parsed.columns.push(column);
    } else if (!section.startsWith("#") && !parsed.columns.includes(section)) {
      parsed.columns.push(section);
    }
  }
  return parsed;
}

function structuredReferenceTable(
  reference: ParsedStructuredReference,
  context: XlsxStructuredReferenceContext,
) {
  if (reference.tableName) {
    const normalizedTableName = normalizeStructuredReferenceName(reference.tableName);
    for (const sheet of context.sheets) {
      const table = (sheet.tables ?? []).find((item) =>
        [item.displayName, item.name].some(
          (name) => normalizeStructuredReferenceName(name ?? "") === normalizedTableName,
        ),
      );
      if (table) return { sheet, table };
    }
    return null;
  }
  const currentPosition = xlsxCellPositionFromRef(context.currentCellReference);
  if (!currentPosition) return null;
  const table = (context.currentSheet.tables ?? []).find((item) => {
    const range = item.ref ? xlsxRangeFromRef(item.ref) : null;
    return range ? rangeContainsPosition(range, currentPosition) : false;
  });
  return table ? { sheet: context.currentSheet, table } : null;
}

function structuredReferenceColumnRange(
  reference: ParsedStructuredReference,
  table: XlsxTable,
  tableRange: NormalizedCellRange,
) {
  if (reference.columns.length === 0) {
    return { left: tableRange.left, right: tableRange.right };
  }
  const indexes = reference.columns
    .map((column) => structuredReferenceColumnIndex(table, column))
    .filter((index): index is number => index !== null);
  if (indexes.length === 0) return null;
  return {
    left: tableRange.left + Math.min(...indexes),
    right: tableRange.left + Math.max(...indexes),
  };
}

function structuredReferenceRowRange(
  reference: ParsedStructuredReference,
  table: XlsxTable,
  tableRange: NormalizedCellRange,
  currentCellReference: string | undefined,
) {
  if (reference.includeThisRow) {
    const currentPosition = xlsxCellPositionFromRef(currentCellReference);
    const dataRange = structuredReferenceDataRowRange(table, tableRange);
    if (!currentPosition || !dataRange || !rangeContainsPosition(dataRange, currentPosition)) {
      return null;
    }
    return { top: currentPosition.row, bottom: currentPosition.row };
  }
  if (reference.includeAll) {
    return { top: tableRange.top, bottom: tableRange.bottom };
  }
  const rowIndexes: number[] = [];
  if (reference.includeHeaders) rowIndexes.push(tableRange.top);
  if (reference.includeTotals && table.totalsRowShown) rowIndexes.push(tableRange.bottom);
  if (
    reference.includeData ||
    (!reference.includeHeaders && !reference.includeTotals)
  ) {
    const dataRange = structuredReferenceDataRowRange(table, tableRange);
    if (!dataRange) return null;
    for (let row = dataRange.top; row <= dataRange.bottom; row += 1) {
      rowIndexes.push(row);
    }
  }
  if (rowIndexes.length === 0) return null;
  return {
    top: Math.min(...rowIndexes),
    bottom: Math.max(...rowIndexes),
  };
}

function structuredReferenceDataRowRange(
  table: XlsxTable,
  tableRange: NormalizedCellRange,
) {
  if (tableRange.top === tableRange.bottom) return null;
  const top = Math.min(tableRange.bottom, tableRange.top + 1);
  const bottom = table.totalsRowShown
    ? Math.max(top, tableRange.bottom - 1)
    : tableRange.bottom;
  return { ...tableRange, top, bottom };
}

function structuredReferenceColumnIndex(table: XlsxTable, columnNameValue: string) {
  const normalizedColumnName = normalizeStructuredReferenceName(columnNameValue);
  const index =
    table.columns?.findIndex(
      (column) => normalizeStructuredReferenceName(column.name ?? "") === normalizedColumnName,
    ) ?? -1;
  return index >= 0 ? index : null;
}

function splitStructuredReferenceSections(value: string) {
  const sections: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "[") depth += 1;
    if (char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      sections.push(value.slice(start, index));
      start = index + 1;
    }
  }
  sections.push(value.slice(start));
  return sections;
}

function structuredReferenceColumnRangeSections(value: string) {
  const match = /^\[([^\]]+)\]\s*:\s*\[([^\]]+)\]$/.exec(value.trim());
  return match ? [match[1], match[2]] : null;
}

function stripOuterBrackets(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return null;
  }
  return trimmed.slice(1, -1);
}

function structuredReferenceRangeReferences(range: NormalizedCellRange) {
  const references: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      references.push(`${columnName(column)}${row + 1}`);
    }
  }
  return references;
}

function normalizeStructuredReferenceName(value: string) {
  return value.trim().toLowerCase();
}

function rangeContainsPosition(
  range: NormalizedCellRange,
  position: { column: number; row: number },
) {
  return (
    position.row >= range.top &&
    position.row <= range.bottom &&
    position.column >= range.left &&
    position.column <= range.right
  );
}

function quoteFormulaSheetName(sheetName: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName)) return sheetName;
  return `'${sheetName.replace(/'/g, "''")}'`;
}
