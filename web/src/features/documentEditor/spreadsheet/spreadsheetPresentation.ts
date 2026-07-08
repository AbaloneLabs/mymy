import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { columnName } from "../shared/models";
import type {
  XlsxCell,
  XlsxChart,
  XlsxMergedRange,
  XlsxPivot,
  XlsxTable,
} from "../shared/models";
import { SPREADSHEET_FORMULA_FUNCTIONS } from "./spreadsheetFormulaCatalog";
import { xlsxRangeFromRef } from "./spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
} from "./spreadsheetGeometry";

/**
 * Spreadsheet presentation helpers translate workbook model details into UI
 * classes, inline styles, labels, and small computed summaries. Keeping this
 * layer separate from the editor component prevents render-specific concerns
 * from leaking into workbook mutation and formula recalculation code.
 */
export type XlsxCellStylePatch = Partial<
  Pick<
    XlsxCell,
    | "numberFormat"
    | "fontFamily"
    | "fontSize"
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "color"
    | "fillColor"
    | "align"
    | "verticalAlign"
    | "wrapText"
  >
>;

export function spreadsheetCellClass(
  activeCell: CellPosition | null,
  selectionRange: NormalizedCellRange | null,
  row: number,
  column: number,
) {
  const selected =
    selectionRange &&
    row >= selectionRange.top &&
    row <= selectionRange.bottom &&
    column >= selectionRange.left &&
    column <= selectionRange.right;
  const active = activeCell?.row === row && activeCell.column === column;
  return cn(
    "border border-[var(--border)]",
    selected && "bg-[var(--accent)]/5",
    active && "outline outline-2 outline-[var(--accent)]",
  );
}

export function xlsxMergedCellClass(
  ranges: XlsxMergedRange[] | undefined,
  row: number,
  column: number,
) {
  const range = ranges
    ?.map((item) => xlsxRangeFromRef(item.ref))
    .filter((item): item is NormalizedCellRange => item !== null)
    .find(
      (item) =>
        row >= item.top &&
        row <= item.bottom &&
        column >= item.left &&
        column <= item.right,
    );
  if (!range) return undefined;
  return row === range.top && column === range.left
    ? "bg-[var(--accent)]/10"
    : "bg-[var(--surface)] text-[var(--text-faint)]";
}

export function summarizeSelection(values: string[][]) {
  const flattened = values.flat();
  const numbers = flattened
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const sum = numbers.reduce((total, value) => total + value, 0);
  return {
    cells: flattened.length,
    numeric: numbers.length,
    sum,
    average: numbers.length > 0 ? sum / numbers.length : null,
  };
}

export function optionalTrimmedString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function xlsxTableLabel(table: XlsxTable) {
  return table.displayName ?? table.name ?? table.id;
}

export function xlsxTableDetail(table: XlsxTable) {
  const columnCount = table.columns?.length;
  return [
    table.ref,
    columnCount ? `${columnCount} columns` : undefined,
    table.totalsRowShown ? "totals" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function xlsxChartLabel(chart: XlsxChart) {
  return [chart.title, chart.type ? `${chart.type} chart` : "chart", chart.path]
    .filter(Boolean)
    .join(" · ");
}

export function xlsxPivotLabel(pivot: XlsxPivot) {
  return [pivot.name, pivot.cacheId ? `cache ${pivot.cacheId}` : "pivot", pivot.id]
    .filter(Boolean)
    .join(" · ");
}

export function xlsxAnchorLabel(anchor: XlsxChart["anchor"]) {
  const from = anchor?.from;
  if (from?.row === undefined || from.column === undefined) return undefined;
  const start = `${columnName(from.column)}${from.row + 1}`;
  const to = anchor?.to;
  if (to?.row === undefined || to.column === undefined) return start;
  return `${start}:${columnName(to.column)}${to.row + 1}`;
}

export function spreadsheetDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function spreadsheetTimeStamp() {
  return new Date().toTimeString().slice(0, 5);
}

export function xlsxCellStyleFromCell(cell: XlsxCell): XlsxCellStylePatch {
  return {
    numberFormat: cell.numberFormat,
    fontFamily: cell.fontFamily,
    fontSize: cell.fontSize,
    bold: cell.bold,
    italic: cell.italic,
    underline: cell.underline,
    strikethrough: cell.strikethrough,
    color: cell.color,
    fillColor: cell.fillColor,
    align: cell.align,
    verticalAlign: cell.verticalAlign,
    wrapText: cell.wrapText,
  };
}

export function normalizeXlsxStylePatch(patch: XlsxCellStylePatch): XlsxCellStylePatch {
  const normalized: XlsxCellStylePatch = {};
  if (patch.numberFormat !== undefined) {
    normalized.numberFormat = patch.numberFormat.trim() || undefined;
  }
  if (patch.fontFamily !== undefined) {
    normalized.fontFamily = patch.fontFamily.trim() || undefined;
  }
  if (patch.fontSize !== undefined) {
    normalized.fontSize = patch.fontSize.trim() || undefined;
  }
  if (patch.bold !== undefined) normalized.bold = patch.bold;
  if (patch.italic !== undefined) normalized.italic = patch.italic;
  if (patch.underline !== undefined) normalized.underline = patch.underline;
  if (patch.strikethrough !== undefined) {
    normalized.strikethrough = patch.strikethrough;
  }
  if (patch.color !== undefined) normalized.color = normalizeCssColor(patch.color);
  if (patch.fillColor !== undefined) {
    normalized.fillColor = normalizeCssColor(patch.fillColor);
  }
  if (patch.align !== undefined) normalized.align = patch.align;
  if (patch.verticalAlign !== undefined) normalized.verticalAlign = patch.verticalAlign;
  if (patch.wrapText !== undefined) normalized.wrapText = patch.wrapText;
  return normalized;
}

export function stripXlsxCellStyle(cell: XlsxCell): XlsxCell {
  return {
    ref: cell.ref,
    value: cell.value,
    formula: cell.formula,
    formulaType: cell.formulaType,
    formulaRef: cell.formulaRef,
    formulaSharedIndex: cell.formulaSharedIndex,
  };
}

export function xlsxCellInputStyle(cell: XlsxCell): CSSProperties {
  return {
    backgroundColor: cell.fillColor,
    color: cell.color,
    fontFamily: cell.fontFamily,
    fontSize: cell.fontSize ? `${cell.fontSize}px` : undefined,
    fontWeight: cell.bold ? 700 : undefined,
    fontStyle: cell.italic ? "italic" : undefined,
    textDecoration:
      cell.underline && cell.strikethrough
        ? "underline line-through"
        : cell.underline
          ? "underline"
          : cell.strikethrough
            ? "line-through"
            : undefined,
    textAlign: cell.align,
    whiteSpace: cell.wrapText ? "pre-wrap" : undefined,
  };
}

export function xlsxHyperlinkCellStyle(
  cell: XlsxCell,
  hasHyperlink: boolean,
): CSSProperties {
  if (!hasHyperlink) return {};
  return {
    color: cell.color ?? "#2563eb",
    textDecoration: xlsxTextDecoration(cell, true),
    textUnderlineOffset: "2px",
  };
}

function xlsxTextDecoration(cell: XlsxCell, forceUnderline = false) {
  const underline = forceUnderline || cell.underline;
  if (underline && cell.strikethrough) return "underline line-through";
  if (underline) return "underline";
  if (cell.strikethrough) return "line-through";
  return undefined;
}

function normalizeCssColor(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : undefined;
}

export function normalizeColorInputValue(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value ?? "#84cc16" : "#84cc16";
}

export function formatNumber(value: number) {
  if (Math.abs(value) >= 1000 || !Number.isInteger(value)) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  }
  return String(value);
}

export function spreadsheetFormulaSuggestions(value: string) {
  const prefix = spreadsheetFormulaFunctionPrefix(value);
  if (prefix === null) return [];
  const normalized = prefix.toUpperCase();
  return SPREADSHEET_FORMULA_FUNCTIONS.filter((item) =>
    item.name.startsWith(normalized),
  ).slice(0, 8);
}

function spreadsheetFormulaFunctionPrefix(value: string) {
  if (!value.startsWith("=")) return null;
  const match = /(?:^|[^A-Za-z0-9_.])([A-Za-z_]*)$/.exec(value);
  if (!match) return null;
  return match[1] ?? "";
}

export function applySpreadsheetFormulaSuggestion(value: string, functionName: string) {
  const base = value.startsWith("=") ? value : "=";
  const prefix = spreadsheetFormulaFunctionPrefix(base) ?? "";
  return `${base.slice(0, base.length - prefix.length)}${functionName}(`;
}
