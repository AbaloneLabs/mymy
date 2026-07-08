import type { XlsxDefinedName, XlsxSheet, XlsxTable } from "./models";
import { rangeToA1 } from "./spreadsheetGeometry";
import type { CellPosition, NormalizedCellRange } from "./spreadsheetGeometry";

export function spreadsheetFillTargetRange(
  source: NormalizedCellRange,
  end: CellPosition,
): NormalizedCellRange {
  return {
    top: Math.min(source.top, end.row),
    right: Math.max(source.right, end.column),
    bottom: Math.max(source.bottom, end.row),
    left: Math.min(source.left, end.column),
  };
}

export function spreadsheetTableResizeTargetRange(
  source: NormalizedCellRange,
  end: CellPosition,
): NormalizedCellRange {
  return {
    top: source.top,
    left: source.left,
    bottom: Math.max(source.top, end.row),
    right: Math.max(source.left, end.column),
  };
}

export function spreadsheetRangeContainsCell(
  range: NormalizedCellRange,
  row: number,
  column: number,
) {
  return (
    row >= range.top &&
    row <= range.bottom &&
    column >= range.left &&
    column <= range.right
  );
}

export function positiveModulo(value: number, divisor: number) {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

export function shiftXlsxTables(
  tables: XlsxTable[] | undefined,
  shiftRange: (reference: string | undefined) => string | undefined,
) {
  return tables?.map((table) => ({
    ...table,
    ref: shiftRange(table.ref) ?? table.ref,
    autoFilterRef: shiftRange(table.autoFilterRef) ?? table.autoFilterRef,
  }));
}

export function buildXlsxTableFromRange(
  sheet: XlsxSheet,
  range: NormalizedCellRange,
  ref: string,
) {
  const tableNumber = nextSpreadsheetTableNumber(sheet.tables ?? []);
  const tableName = `Table${tableNumber}`;
  return {
    id: `local-table-${Date.now()}-${tableNumber}`,
    name: tableName,
    displayName: tableName,
    ref,
    autoFilterRef: ref,
    totalsRowShown: false,
    tableStyleName: "TableStyleMedium2",
    showRowStripes: true,
    columns: buildXlsxTableColumnsForRange(sheet, range),
  } satisfies XlsxTable;
}

export function resizeXlsxTableToRange(
  table: XlsxTable,
  sheet: XlsxSheet,
  range: NormalizedCellRange,
) {
  const ref = rangeToA1(range);
  return {
    ...table,
    ref,
    autoFilterRef: ref,
    columns: buildXlsxTableColumnsForRange(sheet, range, table.columns ?? []),
  } satisfies XlsxTable;
}

export function inferXlsxTableHeaders(
  table: XlsxTable,
  sheet: XlsxSheet,
  range: NormalizedCellRange,
) {
  return {
    ...table,
    columns: buildXlsxTableColumnsForRange(sheet, range, table.columns ?? []),
  } satisfies XlsxTable;
}

function buildXlsxTableColumnsForRange(
  sheet: XlsxSheet,
  range: NormalizedCellRange,
  previousColumns: XlsxTable["columns"] = [],
) {
  return Array.from(
    { length: range.right - range.left + 1 },
    (_, offset) => {
      const previous = previousColumns[offset];
      return {
        ...previous,
        id: String(offset + 1),
        name:
          spreadsheetTableColumnName(
            sheet,
            range.top,
            range.left + offset,
            offset + 1,
          ) ||
          previous?.name ||
          `Column${offset + 1}`,
      };
    },
  );
}

function nextSpreadsheetTableNumber(tables: XlsxTable[]) {
  const used = new Set(
    tables
      .flatMap((table) => [table.name, table.displayName])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  let index = tables.length + 1;
  while (used.has(`table${index}`.toLowerCase())) {
    index += 1;
  }
  return index;
}

function spreadsheetTableColumnName(
  sheet: XlsxSheet,
  rowIndex: number,
  columnIndex: number,
  fallbackIndex: number,
) {
  const value = sheet.rows[rowIndex]?.cells[columnIndex]?.value?.trim();
  return value || `Column${fallbackIndex}`;
}

export function nextDefinedName(
  definedNames: XlsxDefinedName[],
  localSheetId: number,
) {
  const scopeKey = localSheetId >= 0 ? localSheetId : "workbook";
  const namesInScope = new Set(
    definedNames
      .filter((definedName) => (definedName.localSheetId ?? "workbook") === scopeKey)
      .map((definedName) => definedName.name.toLowerCase()),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `Selection_${index}`;
    if (!namesInScope.has(candidate.toLowerCase())) return candidate;
  }
  return `Selection_${Date.now()}`;
}
