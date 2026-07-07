import type { XlsxDefinedName, XlsxTable } from "./models";
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
