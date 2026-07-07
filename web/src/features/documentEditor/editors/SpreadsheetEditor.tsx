import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  CSSProperties,
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  ArrowUpAZ,
  BarChart3,
  Bold,
  Columns3,
  Copy,
  Eraser,
  Filter,
  FilterX,
  Italic,
  Link,
  Lock,
  MessageSquare,
  ImageIcon,
  PaintBucket,
  Palette,
  Plus,
  Printer,
  Sigma,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Unlink,
  WrapText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import { FontFamilySelect } from "../shared";
import {
  SPREADSHEET_FORMULA_FUNCTIONS,
  adjustSpreadsheetFormulaReferences,
  evaluateSpreadsheetFormula,
  formatSpreadsheetFormulaResult,
  spreadsheetFormulaValueBoolean,
  spreadsheetFormulaValueNumber,
} from "../spreadsheetFormula";
import type { SpreadsheetFormulaFunction } from "../spreadsheetFormula";
import {
  DEFAULT_XLSX_COLUMN_WIDTH,
  DEFAULT_XLSX_ROW_HEIGHT,
  MIN_DELIMITED_VISIBLE_COLUMNS,
  MIN_DELIMITED_VISIBLE_ROWS,
  MIN_XLSX_VISIBLE_COLUMNS,
  MIN_XLSX_VISIBLE_ROWS,
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  clampCellRange,
  clampNumber,
  emptyViewport,
  indexRange,
  normalizeCellRange,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  rangeIndexes,
  rangeToA1,
  scrollCellIntoView,
  singleCellRange,
  spacerColumnCount,
  viewportFromElement,
  virtualWindow,
  xlsxCellPositionFromRef,
  xlsxRangeFromRef,
} from "../spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "../spreadsheetGeometry";
import {
  columnName,
  normalizeRow,
  normalizeXlsxCells,
} from "../models";
import type {
  DelimitedTableModel,
  XlsxCell,
  XlsxChart,
  XlsxColumn,
  XlsxConditionalFormatting,
  XlsxConditionalRule,
  XlsxComment,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxImage,
  XlsxMergedRange,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxModel,
  XlsxPivot,
  XlsxRow,
  XlsxSheet,
  XlsxSheetProtection,
  XlsxTable,
} from "../models";

type XlsxCellStylePatch = Partial<
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

type XlsxDataValidationType = NonNullable<XlsxDataValidation["type"]>;
type XlsxDataValidationOperator = NonNullable<XlsxDataValidation["operator"]>;
type XlsxConditionalRuleType = NonNullable<XlsxConditionalRule["type"]>;
type XlsxConditionalOperator = NonNullable<XlsxConditionalRule["operator"]>;

const XLSX_FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"];
const XLSX_NUMBER_FORMATS = [
  { label: "General", value: "" },
  { label: "Number", value: "0.00" },
  { label: "Integer", value: "0" },
  { label: "Percent", value: "0.00%" },
  { label: "Currency", value: "$#,##0.00" },
  { label: "Date", value: "m/d/yy" },
  { label: "Date time", value: "m/d/yy h:mm" },
  { label: "Text", value: "@" },
];
const XLSX_VALIDATION_TYPES: Array<{
  label: string;
  value: "" | XlsxDataValidationType;
}> = [
  { label: "No validation", value: "" },
  { label: "Dropdown list", value: "list" },
  { label: "Whole number", value: "whole" },
  { label: "Decimal", value: "decimal" },
  { label: "Date", value: "date" },
  { label: "Time", value: "time" },
  { label: "Text length", value: "textLength" },
  { label: "Custom formula", value: "custom" },
];
const XLSX_VALIDATION_OPERATORS: Array<{
  label: string;
  value: XlsxDataValidationOperator;
}> = [
  { label: "Between", value: "between" },
  { label: "Not between", value: "notBetween" },
  { label: "Equal", value: "equal" },
  { label: "Not equal", value: "notEqual" },
  { label: "Greater than", value: "greaterThan" },
  { label: "Less than", value: "lessThan" },
  { label: "At least", value: "greaterThanOrEqual" },
  { label: "At most", value: "lessThanOrEqual" },
];
const XLSX_CONDITIONAL_RULE_TYPES: Array<{
  label: string;
  value: "" | XlsxConditionalRuleType;
}> = [
  { label: "No conditional rule", value: "" },
  { label: "Cell value", value: "cellIs" },
  { label: "Custom formula", value: "expression" },
  { label: "Text contains", value: "containsText" },
  { label: "Duplicate values", value: "duplicateValues" },
  { label: "Blank cells", value: "blanks" },
  { label: "Errors", value: "errors" },
];
const XLSX_CONDITIONAL_OPERATORS: Array<{
  label: string;
  value: XlsxConditionalOperator;
}> = [
  { label: "Greater than", value: "greaterThan" },
  { label: "At least", value: "greaterThanOrEqual" },
  { label: "Less than", value: "lessThan" },
  { label: "At most", value: "lessThanOrEqual" },
  { label: "Equal", value: "equal" },
  { label: "Not equal", value: "notEqual" },
  { label: "Between", value: "between" },
  { label: "Not between", value: "notBetween" },
];

export function XlsxEditor({
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  model: XlsxModel;
  onChange: (model: XlsxModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const [preferredSheetId, setPreferredSheetId] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<CellPosition | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<CellPosition | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showFormulas, setShowFormulas] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<SpreadsheetViewport>(emptyViewport);
  const sheet =
    model.sheets.find((item) => item.id === preferredSheetId) ?? model.sheets[0];
  const columnCount = sheet ? xlsxColumnCount(sheet) : MIN_XLSX_VISIBLE_COLUMNS;
  const visibleColumns = visibleXlsxColumns(sheet, columnCount);
  const displaySheet = sheet ? recalculateXlsxSheet(sheet, columnCount) : undefined;
  const displayRows = displaySheet
    ? ensureXlsxDisplayRows(displaySheet, xlsxDisplayRowCount(displaySheet))
    : [];
  const displayGridSheet = displaySheet ? { ...displaySheet, rows: displayRows } : undefined;
  const visibleRows = displayGridSheet
    ? filteredXlsxRows(displayGridSheet.rows, columnCount, filterText)
    : [];
  const displayRowLimit = displayGridSheet?.rows.length ?? 1;
  const rowWindow = virtualWindow(
    visibleRows.length,
    Math.max(0, viewport.scrollTop - SPREADSHEET_HEADER_HEIGHT),
    viewport.height,
    SPREADSHEET_ROW_HEIGHT,
    12,
  );
  const columnWindow = virtualWindow(
    visibleColumns.length,
    Math.max(0, viewport.scrollLeft - SPREADSHEET_ROW_HEADER_WIDTH),
    viewport.width,
    SPREADSHEET_COLUMN_WIDTH,
    4,
  );
  const visibleColumnIndexes = visibleColumns.slice(columnWindow.start, columnWindow.end);
  const leftColumnSpacerWidth = sumXlsxColumnWidths(
    sheet,
    visibleColumns.slice(0, columnWindow.start),
  );
  const rightColumnSpacerWidth = sumXlsxColumnWidths(
    sheet,
    visibleColumns.slice(columnWindow.end),
  );
  const selectionRange = normalizeCellRange(selectionAnchor, selectionEnd);
  const validationRange =
    selectionRange ??
    (activeCell
      ? {
          top: activeCell.row,
          right: activeCell.column,
          bottom: activeCell.row,
          left: activeCell.column,
        }
      : null);
  const activeDataValidation =
    sheet && validationRange
      ? xlsxDataValidationForRange(sheet.dataValidations, validationRange)
      : undefined;
  const activeConditionalRule =
    sheet && validationRange
      ? xlsxConditionalRuleForRange(sheet.conditionalFormattings, validationRange)
      : undefined;
  const activeHyperlink =
    sheet && validationRange
      ? xlsxHyperlinkForRange(sheet.hyperlinks, validationRange)
      : undefined;
  const activeComment =
    sheet && validationRange
      ? xlsxCommentForRange(sheet.comments, validationRange)
      : undefined;
  const activeCellValue =
    activeCell && sheet?.rows[activeCell.row]?.cells[activeCell.column]
      ? formulaBarXlsxCellValue(sheet.rows[activeCell.row].cells[activeCell.column])
      : "";
  const activeCellObject =
    activeCell && sheet?.rows[activeCell.row]?.cells[activeCell.column]
      ? sheet.rows[activeCell.row].cells[activeCell.column]
      : undefined;
  const activeCellStyle = activeCellObject
    ? xlsxCellStyleFromCell(activeCellObject)
    : undefined;
  const activeColumnWidth =
    activeCell && sheet
      ? xlsxColumn(sheet, activeCell.column)?.width ?? DEFAULT_XLSX_COLUMN_WIDTH
      : DEFAULT_XLSX_COLUMN_WIDTH;
  const activeRowHeight =
    activeCell && sheet?.rows[activeCell.row]
      ? sheet.rows[activeCell.row].height ?? DEFAULT_XLSX_ROW_HEIGHT
      : DEFAULT_XLSX_ROW_HEIGHT;
  const frozenRows = sheet?.frozenRows ?? 0;
  const frozenColumns = sheet?.frozenColumns ?? 0;
  const selectedValues =
    displayGridSheet && selectionRange
      ? valuesFromXlsxRange(displayGridSheet, columnCount, selectionRange, showFormulas)
      : activeCellValue
        ? [[activeCellValue]]
        : [];
  const selectionSummary = summarizeSelection(selectedValues);

  function commitXlsxModel(next: XlsxModel) {
    onChange(recalculateXlsxModel(next));
  }

  function updateCell(rowIndex: number, cellIndex: number, value: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                rowIndex + 1,
                Math.max(columnCount, cellIndex + 1),
              ).map((row, currentRowIndex) =>
                currentRowIndex === rowIndex
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(currentRowIndex + 1),
                      ).map((cell, currentCellIndex) =>
                        currentCellIndex === cellIndex
                          ? { ...cell, ...xlsxCellFromInput(value) }
                          : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function updateCellsFromMatrix(
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    if (!sheet || matrix.length === 0) return;
    const requiredRows = startRow + matrix.length;
    const requiredColumns = Math.max(
      columnCount,
      startColumn + Math.max(...matrix.map((row) => row.length)),
    );
    const rows = ensureXlsxRows(sheet, requiredRows, requiredColumns).map(
      (row, rowIndex) => ({
        ...row,
        cells: normalizeXlsxCells(
          row.cells,
          requiredColumns,
          row.index || String(rowIndex + 1),
        ).map((cell, cellIndex) => {
          const pastedRow = matrix[rowIndex - startRow];
          if (!pastedRow || cellIndex < startColumn) return cell;
          const pastedValue = pastedRow[cellIndex - startColumn];
          return pastedValue === undefined
            ? cell
            : { ...cell, ...xlsxCellFromInput(pastedValue) };
        }),
      }),
    );
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, rows } : item,
      ),
    });
  }

  function updateSheetCharts(updater: (charts: XlsxChart[]) => XlsxChart[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, charts: updater(item.charts ?? []) }
          : item,
      ),
    });
  }

  function updateChartTitle(chartId: string, title: string) {
    updateSheetCharts((charts) =>
      charts.map((chart) => (chart.id === chartId ? { ...chart, title } : chart)),
    );
  }

  function updateChartSeriesName(
    chartId: string,
    seriesIndex: number,
    value: string,
  ) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId
          ? {
              ...chart,
              series: (chart.series ?? []).map((series, currentIndex) =>
                currentIndex === seriesIndex ? { ...series, name: value } : series,
              ),
            }
          : chart,
      ),
    );
  }

  function updateChartSeriesPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) {
    updateSheetCharts((charts) =>
      charts.map((chart) =>
        chart.id === chartId
          ? {
              ...chart,
              series: (chart.series ?? []).map((series, currentIndex) => {
                if (currentIndex !== seriesIndex) return series;
                const nextValues = [...(series[key] ?? [])];
                nextValues[pointIndex] = value;
                return { ...series, [key]: nextValues };
              }),
            }
          : chart,
      ),
    );
  }

  function updateSheetPivots(updater: (pivots: XlsxPivot[]) => XlsxPivot[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, pivots: updater(item.pivots ?? []) }
          : item,
      ),
    });
  }

  function updatePivotName(pivotId: string, name: string) {
    updateSheetPivots((pivots) =>
      pivots.map((pivot) =>
        pivot.id === pivotId ? { ...pivot, name } : pivot,
      ),
    );
  }

  function selectCell(position: CellPosition, extend = false) {
    setActiveCell(position);
    if (extend && selectionAnchor) {
      setSelectionEnd(position);
    } else {
      setSelectionAnchor(position);
      setSelectionEnd(position);
    }
  }

  function selectAllCells() {
    setActiveCell({ row: 0, column: 0 });
    setSelectionAnchor({ row: 0, column: 0 });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, 0, 0);
  }

  function selectColumn(column: number) {
    setActiveCell({ row: 0, column });
    setSelectionAnchor({ row: 0, column });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column,
    });
    scrollCellIntoView(gridRef.current, 0, column);
  }

  function selectRow(row: number) {
    setActiveCell({ row, column: 0 });
    setSelectionAnchor({ row, column: 0 });
    setSelectionEnd({
      row,
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, row, 0);
  }

  async function copySelection() {
    if (!sheet || !selectionRange) return;
    await navigator.clipboard?.writeText(rangeToClipboardText(selectedValues));
  }

  function fillDown() {
    if (!sheet || !selectionRange || selectionRange.bottom <= selectionRange.top) return;
    const sourceRow = sheet.rows[selectionRange.top];
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) =>
        Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) => {
            const sourceCell =
              sourceRow?.cells[selectionRange.left + columnOffset];
            return xlsxFillInputFromCell(sourceCell, rowOffset, 0);
          },
        ),
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function fillRight() {
    if (!sheet || !selectionRange || selectionRange.right <= selectionRange.left) return;
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) => {
        const row = sheet.rows[selectionRange.top + rowOffset];
        const source = row?.cells[selectionRange.left];
        return Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) => xlsxFillInputFromCell(source, 0, columnOffset),
        );
      },
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function addRow() {
    if (!sheet) return;
    const insertAt = activeCell ? activeCell.row + 1 : sheet.rows.length;
    const nextRows = ensureXlsxRows(sheet, insertAt, columnCount).map((row, rowIndex) => ({
      ...row,
      cells: normalizeXlsxCells(
        row.cells,
        columnCount,
        row.index || String(rowIndex + 1),
      ),
    }));
    nextRows.splice(insertAt, 0, {
      index: String(insertAt + 1),
      cells: Array.from({ length: columnCount }, (_, index) => ({
        ref: `${columnName(index)}${insertAt + 1}`,
        value: "",
      })),
    });
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: reindexXlsxRows(nextRows, columnCount),
              dataValidations: shiftXlsxDataValidationsForRowInsert(
                item.dataValidations,
                insertAt,
              ),
              conditionalFormattings: shiftXlsxConditionalFormattingsForRowInsert(
                item.conditionalFormattings,
                insertAt,
              ),
              hyperlinks: shiftXlsxHyperlinksForRowInsert(
                item.hyperlinks,
                insertAt,
              ),
              comments: shiftXlsxCommentsForRowInsert(
                item.comments,
                insertAt,
              ),
              autoFilter: shiftXlsxRangeForRowInsert(item.autoFilter, insertAt),
            }
          : item,
      ),
    });
    setActiveCell({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionAnchor({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionEnd({ row: insertAt, column: activeCell?.column ?? 0 });
  }

  function addColumn() {
    if (!sheet) return;
    const insertAt = activeCell ? activeCell.column + 1 : columnCount;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: shiftXlsxColumnsForInsert(item.columns, insertAt),
              dataValidations: shiftXlsxDataValidationsForColumnInsert(
                item.dataValidations,
                insertAt,
              ),
              conditionalFormattings:
                shiftXlsxConditionalFormattingsForColumnInsert(
                  item.conditionalFormattings,
                  insertAt,
                ),
              hyperlinks: shiftXlsxHyperlinksForColumnInsert(
                item.hyperlinks,
                insertAt,
              ),
              comments: shiftXlsxCommentsForColumnInsert(
                item.comments,
                insertAt,
              ),
              autoFilter: shiftXlsxRangeForColumnInsert(item.autoFilter, insertAt),
              rows: item.rows.map((row, rowIndex) => ({
                ...row,
                cells: insertXlsxCell(
                  normalizeXlsxCells(
                    row.cells,
                    columnCount,
                    row.index || String(rowIndex + 1),
                  ),
                  insertAt,
                  row.index || String(rowIndex + 1),
                ),
              })),
            }
          : item,
      ),
    });
    setActiveCell({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionAnchor({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionEnd({ row: activeCell?.row ?? 0, column: insertAt });
  }

  function addSheet() {
    const sheetNumber = model.sheets.length + 1;
    const path = nextXlsxSheetPath(model);
    const next = {
      id: path,
      name: `Sheet ${sheetNumber}`,
      rows: [
        {
          index: "1",
          cells: Array.from({ length: 5 }, (_, index) => ({
            ref: `${columnName(index)}1`,
            value: "",
          })),
        },
      ],
    };
    commitXlsxModel({ sheets: [...model.sheets, next] });
    setPreferredSheetId(next.id);
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function duplicateSheet() {
    if (!sheet) return;
    const path = nextXlsxSheetPath(model);
    const next = {
      id: path,
      name: `${sheet.name} Copy`,
      state: "visible" as const,
      tabColor: sheet.tabColor,
      tabColorSourceXml: sheet.tabColorSourceXml,
      columns: sheet.columns?.map((column) => ({ ...column })),
      mergedRanges: sheet.mergedRanges?.map((range) => ({ ...range })),
      dataValidations: sheet.dataValidations?.map((validation) => ({
        ...validation,
      })),
      conditionalFormattings: sheet.conditionalFormattings?.map((formatting) => ({
        ...formatting,
        rules: formatting.rules.map((rule) => ({ ...rule })),
      })),
      hyperlinks: sheet.hyperlinks?.map((hyperlink) => ({ ...hyperlink })),
      comments: sheet.comments?.map((comment) => ({ ...comment })),
      protection: sheet.protection ? { ...sheet.protection } : undefined,
      pageMargins: sheet.pageMargins ? { ...sheet.pageMargins } : undefined,
      pageSetup: sheet.pageSetup ? { ...sheet.pageSetup } : undefined,
      autoFilter: sheet.autoFilter,
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
      rows: sheet.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell })),
      })),
    };
    commitXlsxModel({ sheets: [...model.sheets, next] });
    setPreferredSheetId(next.id);
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function deleteSheet() {
    if (!sheet || model.sheets.length <= 1) return;
    const nextSheets = model.sheets.filter((item) => item.id !== sheet.id);
    commitXlsxModel({ sheets: nextSheets });
    setPreferredSheetId(nextSheets[0]?.id ?? null);
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function renameSheet(name: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, name } : item,
      ),
    });
  }

  function updateSheetState(state: XlsxSheet["state"]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, state: state === "visible" ? "visible" : state }
          : item,
      ),
    });
  }

  function updateSheetTabColor(tabColor: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tabColor,
              tabColorSourceXml: undefined,
            }
          : item,
      ),
    });
  }

  function moveSheet(direction: -1 | 1) {
    if (!sheet) return;
    const index = model.sheets.findIndex((item) => item.id === sheet.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= model.sheets.length) return;
    const nextSheets = [...model.sheets];
    const [moved] = nextSheets.splice(index, 1);
    nextSheets.splice(nextIndex, 0, moved);
    commitXlsxModel({ sheets: nextSheets });
  }

  function sortRowsByActiveColumn(direction: "asc" | "desc") {
    if (!sheet || !activeCell) return;
    const sorted = sortXlsxRows(displaySheet?.rows ?? sheet.rows, columnCount, activeCell.column, direction);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, rows: sorted } : item,
      ),
    });
  }

  function deleteActiveRow() {
    if (
      !sheet ||
      !activeCell ||
      activeCell.row >= sheet.rows.length ||
      sheet.rows.length <= 1
    ) {
      return;
    }
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows
                .filter((_, index) => index !== activeCell.row)
                .map((row, index) => ({
                  ...row,
                  index: String(index + 1),
                  cells: row.cells.map((cell, cellIndex) => ({
                    ...cell,
                    ref: `${columnName(cellIndex)}${index + 1}`,
                  })),
                })),
              dataValidations: shiftXlsxDataValidationsForRowDelete(
                item.dataValidations,
                activeCell.row,
              ),
              conditionalFormattings: shiftXlsxConditionalFormattingsForRowDelete(
                item.conditionalFormattings,
                activeCell.row,
              ),
              hyperlinks: shiftXlsxHyperlinksForRowDelete(
                item.hyperlinks,
                activeCell.row,
              ),
              comments: shiftXlsxCommentsForRowDelete(
                item.comments,
                activeCell.row,
              ),
              autoFilter: shiftXlsxRangeForRowDelete(
                item.autoFilter,
                activeCell.row,
              ),
            }
          : item,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function deleteActiveColumn() {
    if (!sheet || !activeCell || columnCount <= 1) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) => ({
                ...row,
                cells: normalizeXlsxCells(
                  row.cells,
                  columnCount,
                  row.index || String(rowIndex + 1),
                )
                  .filter((_, index) => index !== activeCell.column)
                  .map((cell, cellIndex) => ({
                    ...cell,
                    ref: `${columnName(cellIndex)}${row.index || rowIndex + 1}`,
                  })),
              })),
              columns: shiftXlsxColumnsForDelete(item.columns, activeCell.column),
              dataValidations: shiftXlsxDataValidationsForColumnDelete(
                item.dataValidations,
                activeCell.column,
              ),
              conditionalFormattings:
                shiftXlsxConditionalFormattingsForColumnDelete(
                  item.conditionalFormattings,
                  activeCell.column,
                ),
              hyperlinks: shiftXlsxHyperlinksForColumnDelete(
                item.hyperlinks,
                activeCell.column,
              ),
              comments: shiftXlsxCommentsForColumnDelete(
                item.comments,
                activeCell.column,
              ),
              autoFilter: shiftXlsxRangeForColumnDelete(
                item.autoFilter,
                activeCell.column,
              ),
            }
          : item,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.row, activeCell.column, "");
  }

  function updateSelectedCells(
    updater: (cell: XlsxCell, rowIndex: number, cellIndex: number) => XlsxCell,
  ) {
    if (!sheet) return;
    const range =
      selectionRange ??
      (activeCell
        ? {
            top: activeCell.row,
            right: activeCell.column,
            bottom: activeCell.row,
            left: activeCell.column,
          }
        : null);
    if (!range) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                range.bottom + 1,
                Math.max(columnCount, range.right + 1),
              ).map((row, rowIndex) =>
                rowIndex >= range.top && rowIndex <= range.bottom
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(rowIndex + 1),
                      ).map((cell, cellIndex) =>
                        cellIndex >= range.left && cellIndex <= range.right
                          ? updater(cell, rowIndex, cellIndex)
                          : cell,
                      ),
                    }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function applyCellStyle(patch: XlsxCellStylePatch) {
    updateSelectedCells((cell) => ({
      ...cell,
      ...normalizeXlsxStylePatch(patch),
    }));
  }

  function clearSelectedCellFormat() {
    updateSelectedCells(stripXlsxCellStyle);
  }

  function updateActiveColumnWidth(width: number) {
    if (!sheet || !activeCell || !Number.isFinite(width)) return;
    updateColumnWidth(activeCell.column, width);
  }

  function updateColumnWidth(columnIndex: number, width: number) {
    if (!sheet || !Number.isFinite(width)) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: upsertXlsxColumn(item.columns, columnIndex, {
                width: clampNumber(width, 4, 80),
              }),
            }
          : item,
      ),
    });
  }

  function updateActiveRowHeight(height: number) {
    if (!sheet || !activeCell || !Number.isFinite(height)) return;
    updateRowHeight(activeCell.row, height);
  }

  function updateRowHeight(targetRowIndex: number, height: number) {
    if (!sheet || !Number.isFinite(height)) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) =>
                rowIndex === targetRowIndex
                  ? { ...row, height: clampNumber(height, 8, 180) }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function startColumnResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    columnIndex: number,
  ) {
    if (!sheet) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidthPx = xlsxColumnWidthPx(sheet, columnIndex);
    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidthPx = Math.max(48, startWidthPx + moveEvent.clientX - startX);
      updateColumnWidth(columnIndex, (nextWidthPx - 12) / 7);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function startRowResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    rowIndex: number,
  ) {
    if (!sheet) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeightPx = xlsxRowHeightPx(sheet.rows[rowIndex]);
    const handleMove = (moveEvent: PointerEvent) => {
      const nextHeightPx = Math.max(24, startHeightPx + moveEvent.clientY - startY);
      updateRowHeight(rowIndex, nextHeightPx * 0.75);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function hideSelectedRows() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: item.rows.map((row, rowIndex) =>
                rowIndex >= selectionRange.top && rowIndex <= selectionRange.bottom
                  ? { ...row, hidden: true }
                  : row,
              ),
            }
          : item,
      ),
    });
  }

  function hideSelectedColumns() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: rangeIndexes(selectionRange.left, selectionRange.right).reduce(
                (columns, columnIndex) =>
                  upsertXlsxColumn(columns, columnIndex, { hidden: true }),
                item.columns ?? [],
              ),
            }
          : item,
      ),
    });
  }

  function unhideAllRowsAndColumns() {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              columns: (item.columns ?? []).map((column) => ({
                ...column,
                hidden: false,
              })),
              rows: item.rows.map((row) => ({ ...row, hidden: false })),
            }
          : item,
      ),
    });
  }

  function updateFrozenRows(value: number) {
    if (!sheet || !Number.isFinite(value)) return;
    const frozenRows = Math.floor(clampNumber(value, 0, Math.max(0, displayRowLimit - 1)));
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, frozenRows: frozenRows || undefined }
          : item,
      ),
    });
  }

  function updateFrozenColumns(value: number) {
    if (!sheet || !Number.isFinite(value)) return;
    const frozenColumns = Math.floor(clampNumber(value, 0, Math.max(0, columnCount - 1)));
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, frozenColumns: frozenColumns || undefined }
          : item,
      ),
    });
  }

  function mergeSelection() {
    if (!sheet || !selectionRange || singleCellRange(selectionRange)) return;
    const ref = rangeToA1(selectionRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              mergedRanges: [
                ...nonOverlappingMergedRanges(item.mergedRanges ?? [], selectionRange),
                { ref },
              ],
            }
          : item,
      ),
    });
  }

  function unmergeSelection() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              mergedRanges: nonOverlappingMergedRanges(
                item.mergedRanges ?? [],
                selectionRange,
              ),
            }
          : item,
      ),
    });
  }

  function setAutoFilterFromSelection() {
    if (!sheet || !selectionRange) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, autoFilter: rangeToA1(selectionRange) }
          : item,
      ),
    });
  }

  function clearAutoFilter() {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id ? { ...item, autoFilter: undefined } : item,
      ),
    });
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (commandId === "fillDown") {
      fillDown();
    } else if (commandId === "fillRight") {
      fillRight();
    } else if (commandId === "sortAscending") {
      sortRowsByActiveColumn("asc");
    } else if (commandId === "sortDescending") {
      sortRowsByActiveColumn("desc");
    } else if (commandId === "filter") {
      if (sheet?.autoFilter) clearAutoFilter();
      else setAutoFilterFromSelection();
    } else {
      return false;
    }
    return true;
    },
  );

  useEffect(() => {
    if (!commandRequest || handledCommandTokenRef.current === commandRequest.token) return;
    handledCommandTokenRef.current = commandRequest.token;
    window.setTimeout(() => {
      if (handleCommandRequest(commandRequest.id)) {
        onCommandHandled?.(commandRequest);
      }
    }, 0);
  }, [commandRequest, onCommandHandled]);

  function applyDataValidation(validation: XlsxDataValidation | null) {
    if (!sheet || !validationRange) return;
    const sqref = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              dataValidations: validation
                ? [
                    ...nonOverlappingDataValidations(
                      item.dataValidations ?? [],
                      validationRange,
                    ),
                    {
                      ...validation,
                      sqref,
                    },
                  ]
                : nonOverlappingDataValidations(
                    item.dataValidations ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyConditionalFormatting(rule: XlsxConditionalRule | null) {
    if (!sheet || !validationRange) return;
    const sqref = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              conditionalFormattings: rule
                ? [
                    ...nonOverlappingConditionalFormattings(
                      item.conditionalFormattings ?? [],
                      validationRange,
                    ),
                    {
                      sqref,
                      rules: [
                        {
                          ...rule,
                          sourceXml: undefined,
                        },
                      ],
                    },
                  ]
                : nonOverlappingConditionalFormattings(
                    item.conditionalFormattings ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyHyperlink(hyperlink: XlsxHyperlink | null) {
    if (!sheet || !validationRange) return;
    const reference = rangeToA1(validationRange);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              hyperlinks: hyperlink
                ? [
                    ...nonOverlappingHyperlinks(
                      item.hyperlinks ?? [],
                      validationRange,
                    ),
                    {
                      ...hyperlink,
                      ref: reference,
                      relationshipId: undefined,
                    },
                  ]
                : nonOverlappingHyperlinks(
                    item.hyperlinks ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function applyComment(comment: XlsxComment | null) {
    if (!sheet || !validationRange) return;
    const reference = activeCell
      ? `${columnName(activeCell.column)}${activeCell.row + 1}`
      : `${columnName(validationRange.left)}${validationRange.top + 1}`;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              comments: comment
                ? [
                    ...nonOverlappingComments(
                      item.comments ?? [],
                      validationRange,
                    ),
                    {
                      ...comment,
                      ref: reference,
                    },
                  ]
                : nonOverlappingComments(
                    item.comments ?? [],
                    validationRange,
                  ),
            }
          : item,
      ),
    });
  }

  function updateSheetSettings(patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    });
  }

  function selectReference(reference: string) {
    if (!sheet) return;
    const range = xlsxRangeFromRef(reference.trim());
    if (!range) return;
    const clamped = clampCellRange(range, displayRowLimit, columnCount);
    setActiveCell({ row: clamped.top, column: clamped.left });
    setSelectionAnchor({ row: clamped.top, column: clamped.left });
    setSelectionEnd({ row: clamped.bottom, column: clamped.right });
    scrollCellIntoView(gridRef.current, clamped.top, clamped.left);
  }

  function focusCell(row: number, column: number) {
    selectCell({ row, column });
    scrollCellIntoView(gridRef.current, row, column);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-spreadsheet-cell="${row}:${column}"]`,
      );
      input?.focus();
      input?.select();
    });
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    row: number,
    column: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (primary && event.key.toLowerCase() === "d") {
      event.preventDefault();
      fillDown();
      return;
    }
    if (primary && event.key.toLowerCase() === "r") {
      event.preventDefault();
      fillRight();
      return;
    }
    if (primary && event.key.toLowerCase() === "b") {
      event.preventDefault();
      applyCellStyle({ bold: !activeCellStyle?.bold });
      return;
    }
    if (primary && event.key.toLowerCase() === "i") {
      event.preventDefault();
      applyCellStyle({ italic: !activeCellStyle?.italic });
      return;
    }
    if (primary && event.key.toLowerCase() === "u") {
      event.preventDefault();
      applyCellStyle({ underline: !activeCellStyle?.underline });
      return;
    }
    if (primary && event.key === "`") {
      event.preventDefault();
      setShowFormulas((current) => !current);
      return;
    }
    if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      selectCell(
        { row: Math.min(row + 1, displayRowLimit - 1), column },
        true,
      );
      return;
    }
    if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row: Math.max(row - 1, 0), column }, true);
      return;
    }
    if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.min(column + 1, columnCount - 1) }, true);
      return;
    }
    if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.max(column - 1, 0) }, true);
      return;
    }
    if (primary && event.key === ";") {
      event.preventDefault();
      updateCell(
        row,
        column,
        event.shiftKey ? spreadsheetTimeStamp() : spreadsheetDateStamp(),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusCell(
        event.shiftKey
          ? Math.max(row - 1, 0)
          : Math.min(row + 1, displayRowLimit - 1),
        column,
      );
    } else if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const nextColumn = column + direction;
      if (nextColumn >= 0 && nextColumn < columnCount) {
        focusCell(row, nextColumn);
      } else if (!event.shiftKey && row < displayRowLimit - 1) {
        focusCell(row + 1, 0);
      } else if (event.shiftKey && row > 0) {
        focusCell(row - 1, columnCount - 1);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SpreadsheetToolbar
        activeCellLabel={
          selectionRange
            ? rangeToA1(selectionRange)
            : activeCell
              ? `${columnName(activeCell.column)}${activeCell.row + 1}`
              : "-"
        }
        activeCellValue={activeCellValue}
        activeCellDisabled={!activeCell}
        onActiveCellLabelChange={selectReference}
        onActiveCellChange={(value) => {
          if (!activeCell) return;
          updateCell(activeCell.row, activeCell.column, value);
        }}
        onAddRow={addRow}
        onAddColumn={addColumn}
        onDeleteRow={deleteActiveRow}
        onDeleteColumn={deleteActiveColumn}
        onClearCell={clearActiveCell}
        onCopySelection={() => void copySelection()}
        onFillDown={fillDown}
        onFillRight={fillRight}
        onSortAsc={() => sortRowsByActiveColumn("asc")}
        onSortDesc={() => sortRowsByActiveColumn("desc")}
        filterText={filterText}
        onFilterTextChange={setFilterText}
        autoFilter={sheet?.autoFilter}
        onSetAutoFilter={setAutoFilterFromSelection}
        onClearAutoFilter={clearAutoFilter}
        showFormulas={showFormulas}
        onToggleShowFormulas={() => setShowFormulas((current) => !current)}
        activeColumnWidth={activeColumnWidth}
        activeRowHeight={activeRowHeight}
        onActiveColumnWidthChange={updateActiveColumnWidth}
        onActiveRowHeightChange={updateActiveRowHeight}
        onHideRows={hideSelectedRows}
        onHideColumns={hideSelectedColumns}
        onUnhideAll={unhideAllRowsAndColumns}
        frozenRows={frozenRows}
        frozenColumns={frozenColumns}
        onFrozenRowsChange={updateFrozenRows}
        onFrozenColumnsChange={updateFrozenColumns}
        onMergeCells={mergeSelection}
        onUnmergeCells={unmergeSelection}
        activeDataValidation={activeDataValidation}
        onApplyDataValidation={applyDataValidation}
        activeConditionalRule={activeConditionalRule}
        onApplyConditionalFormatting={applyConditionalFormatting}
        activeHyperlink={activeHyperlink}
        onApplyHyperlink={applyHyperlink}
        activeComment={activeComment}
        onApplyComment={applyComment}
        sheetProtection={sheet?.protection}
        pageMargins={sheet?.pageMargins}
        pageSetup={sheet?.pageSetup}
        onSheetSettingsChange={updateSheetSettings}
        activeCellStyle={activeCellStyle}
        onApplyCellStyle={applyCellStyle}
        onClearCellFormat={clearSelectedCellFormat}
        canDeleteRow={Boolean(
          activeCell &&
            sheet &&
            activeCell.row < sheet.rows.length &&
            sheet.rows.length > 1,
        )}
        canDeleteColumn={Boolean(activeCell && columnCount > 1)}
        canClearCell={Boolean(activeCell)}
        canCopy={Boolean(selectionRange)}
        canFillDown={Boolean(selectionRange && selectionRange.bottom > selectionRange.top)}
        canFillRight={Boolean(selectionRange && selectionRange.right > selectionRange.left)}
        canSetAutoFilter={Boolean(selectionRange)}
        canMerge={Boolean(selectionRange && !singleCellRange(selectionRange))}
        canUnmerge={Boolean(selectionRange && sheet?.mergedRanges?.length)}
        canValidate={Boolean(validationRange)}
        canApplyConditionalFormatting={Boolean(validationRange)}
        canApplyHyperlink={Boolean(validationRange)}
        canApplyComment={Boolean(validationRange)}
        canHide={Boolean(selectionRange)}
        canFormat={Boolean(activeCell || selectionRange)}
        canSort={Boolean(activeCell)}
      />
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {model.sheets.map((item) => {
          const hidden = item.state === "hidden" || item.state === "veryHidden";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setPreferredSheetId(item.id);
                setActiveCell(null);
              }}
              className={cn(
                "rounded-md border-t-2 px-2 py-1 text-xs",
                item.id === sheet?.id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                hidden && "opacity-60",
              )}
              style={{
                borderTopColor: item.tabColor ?? "transparent",
              }}
              title={hidden ? `Sheet is ${item.state}` : undefined}
            >
              {item.name}
              {hidden && <span className="ml-1 text-[10px] uppercase">{item.state}</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={addSheet}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Add sheet"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={duplicateSheet}
          disabled={!sheet}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Duplicate sheet"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={deleteSheet}
          disabled={!sheet || model.sheets.length <= 1}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Delete sheet"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => moveSheet(-1)}
          disabled={!sheet || model.sheets.findIndex((item) => item.id === sheet.id) <= 0}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Move sheet left"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => moveSheet(1)}
          disabled={
            !sheet ||
            model.sheets.findIndex((item) => item.id === sheet.id) >=
              model.sheets.length - 1
          }
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Move sheet right"
        >
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        {sheet && (
          <>
            <input
              value={sheet.name}
              onChange={(event) => renameSheet(event.target.value)}
              className="ml-auto h-7 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              aria-label="Sheet name"
            />
            <select
              value={sheet.state ?? "visible"}
              onChange={(event) =>
                updateSheetState(event.currentTarget.value as XlsxSheet["state"])
              }
              className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              aria-label="Sheet visibility"
            >
              <option value="visible">Visible</option>
              <option value="hidden">Hidden</option>
              <option value="veryHidden">Very hidden</option>
            </select>
            <input
              type="color"
              value={normalizeColorInputValue(sheet.tabColor)}
              onChange={(event) => updateSheetTabColor(event.currentTarget.value)}
              className="h-7 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg)] p-1"
              aria-label="Sheet tab color"
            />
          </>
        )}
      </div>
      <SpreadsheetObjectStrip
        sheet={sheet}
        onChartTitleChange={updateChartTitle}
        onChartSeriesNameChange={updateChartSeriesName}
        onChartPointChange={updateChartSeriesPoint}
        onPivotNameChange={updatePivotName}
      />
      <div
        ref={gridRef}
        onScroll={(event) => setViewport(viewportFromElement(event.currentTarget))}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        <table className="border-collapse text-xs shadow-sm">
          <thead>
            <tr>
              <th
                onClick={selectAllCells}
                className={cn(
                  "sticky left-0 top-0 z-20 h-8 min-w-12 cursor-pointer border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                  rangeCoversSheet(selectionRange, displayRowLimit, columnCount) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
                title="Select all cells"
              />
              {columnWindow.start > 0 && (
                <th
                  aria-hidden="true"
                  className="sticky top-0 z-10 h-8 border border-transparent bg-[var(--surface)]"
                  style={{ minWidth: leftColumnSpacerWidth, width: leftColumnSpacerWidth }}
                />
              )}
              {visibleColumnIndexes.map((index) => (
                <th
                  key={index}
                  onClick={() => selectColumn(index)}
                  className={cn(
                    "group relative sticky top-0 z-10 h-8 min-w-32 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-center font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                    rangeCoversColumn(selectionRange, index, displayRowLimit) &&
                      "bg-[var(--accent)]/10 text-[var(--accent)]",
                  )}
                  style={{
                    minWidth: xlsxColumnWidthPx(sheet, index),
                    width: xlsxColumnWidthPx(sheet, index),
                  }}
                >
                  {columnName(index)}
                  <button
                    type="button"
                    onPointerDown={(event) => startColumnResize(event, index)}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 hover:bg-[var(--accent)]/30 group-hover:opacity-100"
                    title="Resize column"
                  />
                </th>
              ))}
              {columnWindow.end < visibleColumns.length && (
                <th
                  aria-hidden="true"
                  className="sticky top-0 z-10 h-8 border border-transparent bg-[var(--surface)]"
                  style={{ minWidth: rightColumnSpacerWidth, width: rightColumnSpacerWidth }}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {rowWindow.start > 0 && (
              <SpreadsheetSpacerRow
                height={rowWindow.start * SPREADSHEET_ROW_HEIGHT}
                columnSpan={visibleColumnIndexes.length + spacerColumnCount(columnWindow, visibleColumns.length)}
              />
            )}
            {visibleRows.slice(rowWindow.start, rowWindow.end).map(({ row, rowIndex }) => (
              <tr
                key={`${sheet.id}:${row.index}:${rowIndex}`}
                style={{ height: xlsxRowHeightPx(row) }}
              >
                <th
                  onClick={() => selectRow(rowIndex)}
                  className={cn(
                    "group relative sticky left-0 z-10 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                    rangeCoversRow(selectionRange, rowIndex, columnCount) &&
                      "bg-[var(--accent)]/10 text-[var(--accent)]",
                  )}
                >
                  {row.index || rowIndex + 1}
                  <button
                    type="button"
                    onPointerDown={(event) => startRowResize(event, rowIndex)}
                    className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize opacity-0 hover:bg-[var(--accent)]/30 group-hover:opacity-100"
                    title="Resize row"
                  />
                </th>
                {columnWindow.start > 0 && (
                  <SpreadsheetColumnSpacer width={leftColumnSpacerWidth} />
                )}
                {visibleColumnIndexes.map((cellIndex) => {
                  const cell = normalizeXlsxCells(
                    row.cells,
                    columnCount,
                    row.index || String(rowIndex + 1),
                  )[cellIndex];
                  const mergedClass = xlsxMergedCellClass(
                    sheet?.mergedRanges,
                    rowIndex,
                    cellIndex,
                  );
                  const hasValidation = xlsxCellHasDataValidation(
                    sheet?.dataValidations,
                    rowIndex,
                    cellIndex,
                  );
                  const hasHyperlink = xlsxCellHasHyperlink(
                    sheet?.hyperlinks,
                    rowIndex,
                    cellIndex,
                  );
                  const hasComment = xlsxCellHasComment(
                    sheet?.comments,
                    rowIndex,
                    cellIndex,
                  );
                  const conditionalStyle = xlsxConditionalCellStyle(
                    sheet?.conditionalFormattings,
                    displaySheet,
                    rowIndex,
                    cellIndex,
                    cell,
                    columnCount,
                  );
                  const hasConditionalStyle =
                    conditionalStyle.backgroundColor !== undefined;
                  return (
                  <td
                    key={`${cell.ref}:${cellIndex}`}
                    className={cn(
                      "relative",
                      spreadsheetCellClass(
                        activeCell,
                        selectionRange,
                        rowIndex,
                        cellIndex,
                      ),
                      mergedClass,
                      hasValidation && "shadow-[inset_0_-2px_0_rgba(132,204,22,0.55)]",
                      hasConditionalStyle &&
                        "shadow-[inset_0_0_0_1px_rgba(132,204,22,0.35)]",
                    )}
                  >
                    {hasComment && (
                      <span className="pointer-events-none absolute right-0 top-0 z-10 h-0 w-0 border-l-[8px] border-l-transparent border-t-[8px] border-t-amber-400" />
                    )}
                    <input
                      data-spreadsheet-cell={`${rowIndex}:${cellIndex}`}
                      value={displayXlsxCellValue(cell, showFormulas)}
                      onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)}
                      onFocus={() =>
                        setActiveCell({ row: rowIndex, column: cellIndex })
                      }
                      onMouseDown={(event) =>
                        selectCell({ row: rowIndex, column: cellIndex }, event.shiftKey)
                      }
                      onMouseEnter={(event) => {
                        if (event.buttons === 1) {
                          selectCell({ row: rowIndex, column: cellIndex }, true);
                        }
                      }}
                      onKeyDown={(event) => handleCellKeyDown(event, rowIndex, cellIndex)}
                      onPaste={(event) => {
                        const matrix = clipboardDataToMatrix(event.clipboardData);
                        if (matrix) {
                          event.preventDefault();
                          updateCellsFromMatrix(rowIndex, cellIndex, matrix);
                        }
                      }}
                      className={cn(
                        "h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]",
                        mergedClass,
                      )}
                      style={{
                        minWidth: xlsxColumnWidthPx(sheet, cellIndex),
                        width: xlsxColumnWidthPx(sheet, cellIndex),
                        height: xlsxRowHeightPx(row),
                        ...xlsxCellInputStyle(cell),
                        ...conditionalStyle,
                        ...xlsxHyperlinkCellStyle(cell, hasHyperlink),
                      }}
                      title={[
                        cell.ref,
                        hasValidation ? "data validation" : null,
                        hasConditionalStyle ? "conditional formatting" : null,
                        hasHyperlink ? "hyperlink" : null,
                        hasComment ? "comment" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </td>
                  );
                })}
                {columnWindow.end < visibleColumns.length && (
                  <SpreadsheetColumnSpacer width={rightColumnSpacerWidth} />
                )}
              </tr>
            ))}
            {rowWindow.end < visibleRows.length && (
              <SpreadsheetSpacerRow
                height={(visibleRows.length - rowWindow.end) * SPREADSHEET_ROW_HEIGHT}
                columnSpan={visibleColumnIndexes.length + spacerColumnCount(columnWindow, visibleColumns.length)}
              />
            )}
          </tbody>
        </table>
      </div>
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}

export function DelimitedTableEditor({
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  model: DelimitedTableModel;
  onChange: (model: DelimitedTableModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const { t } = useTranslation();
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<CellPosition | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<CellPosition | null>(null);
  const [filterText, setFilterText] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<SpreadsheetViewport>(emptyViewport);
  const sourceRows = model.rows.length > 0 ? model.rows : [[]];
  const sourceColumnCount = Math.max(1, ...sourceRows.map((row) => row.length));
  const columnCount = Math.max(MIN_DELIMITED_VISIBLE_COLUMNS, sourceColumnCount);
  const displayRowLimit = Math.max(MIN_DELIMITED_VISIBLE_ROWS, sourceRows.length);
  const rows = ensureDelimitedDisplayRows(sourceRows, displayRowLimit);
  const visibleRows = filteredDelimitedRows(rows, columnCount, filterText);
  const rowWindow = virtualWindow(
    visibleRows.length,
    Math.max(0, viewport.scrollTop - SPREADSHEET_HEADER_HEIGHT),
    viewport.height,
    SPREADSHEET_ROW_HEIGHT,
    12,
  );
  const columnWindow = virtualWindow(
    columnCount,
    Math.max(0, viewport.scrollLeft - SPREADSHEET_ROW_HEADER_WIDTH),
    viewport.width,
    SPREADSHEET_COLUMN_WIDTH,
    4,
  );
  const visibleColumnIndexes = indexRange(columnWindow.start, columnWindow.end);
  const selectionRange = normalizeCellRange(selectionAnchor, selectionEnd);
  const activeCellValue =
    activeCell && rows[activeCell.row]?.[activeCell.column]
      ? rows[activeCell.row][activeCell.column]
      : "";
  const selectedValues = selectionRange
    ? valuesFromDelimitedRange(rows, columnCount, selectionRange)
    : activeCellValue
      ? [[activeCellValue]]
      : [];
  const selectionSummary = summarizeSelection(selectedValues);

  function commitDelimitedRows(nextRows: string[][]) {
    onChange({
      ...model,
      rows: nextRows,
    });
  }

  function updateCell(rowIndex: number, columnIndex: number, value: string) {
    const requiredColumns = Math.max(sourceColumnCount, columnIndex + 1);
    commitDelimitedRows(
      ensureDelimitedRows(sourceRows, rowIndex + 1, requiredColumns).map(
        (row, currentRowIndex) => {
          if (currentRowIndex !== rowIndex) return row;
          return row.map((cell, currentColumnIndex) =>
            currentColumnIndex === columnIndex ? value : cell,
          );
        },
      ),
    );
  }

  function updateCellsFromMatrix(
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) {
    if (matrix.length === 0) return;
    const requiredRows = startRow + matrix.length;
    const requiredColumns = Math.max(
      sourceColumnCount,
      startColumn + Math.max(...matrix.map((row) => row.length)),
    );
    const nextRows = ensureDelimitedRows(sourceRows, requiredRows, requiredColumns).map((row, rowIndex) => {
      const pastedRow = matrix[rowIndex - startRow];
      if (!pastedRow) return row;
      return row.map((cell, columnIndex) => {
        if (columnIndex < startColumn) return cell;
        const pastedValue = pastedRow[columnIndex - startColumn];
        return pastedValue === undefined ? cell : pastedValue;
      });
    });
    commitDelimitedRows(nextRows);
  }

  function selectCell(position: CellPosition, extend = false) {
    setActiveCell(position);
    if (extend && selectionAnchor) {
      setSelectionEnd(position);
    } else {
      setSelectionAnchor(position);
      setSelectionEnd(position);
    }
  }

  function selectAllCells() {
    setActiveCell({ row: 0, column: 0 });
    setSelectionAnchor({ row: 0, column: 0 });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, 0, 0);
  }

  function selectColumn(column: number) {
    setActiveCell({ row: 0, column });
    setSelectionAnchor({ row: 0, column });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column,
    });
    scrollCellIntoView(gridRef.current, 0, column);
  }

  function selectRow(row: number) {
    setActiveCell({ row, column: 0 });
    setSelectionAnchor({ row, column: 0 });
    setSelectionEnd({
      row,
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, row, 0);
  }

  async function copySelection() {
    if (!selectionRange) return;
    await navigator.clipboard?.writeText(rangeToClipboardText(selectedValues));
  }

  function fillDown() {
    if (!selectionRange || selectionRange.bottom <= selectionRange.top) return;
    const sourceRow = normalizeRow(rows[selectionRange.top] ?? [], columnCount);
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) =>
        Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) =>
            rowOffset === 0
              ? sourceRow[selectionRange.left + columnOffset] ?? ""
              : sourceRow[selectionRange.left + columnOffset] ?? "",
        ),
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function fillRight() {
    if (!selectionRange || selectionRange.right <= selectionRange.left) return;
    const matrix = Array.from(
      { length: selectionRange.bottom - selectionRange.top + 1 },
      (_, rowOffset) => {
        const row = normalizeRow(rows[selectionRange.top + rowOffset] ?? [], columnCount);
        const source = row[selectionRange.left] ?? "";
        return Array.from(
          { length: selectionRange.right - selectionRange.left + 1 },
          (_, columnOffset) =>
            columnOffset === 0 ? row[selectionRange.left] ?? "" : source,
        );
      },
    );
    updateCellsFromMatrix(selectionRange.top, selectionRange.left, matrix);
  }

  function sortRowsByActiveColumn(direction: "asc" | "desc") {
    if (!activeCell) return;
    commitDelimitedRows(
      sortDelimitedRows(sourceRows, sourceColumnCount, activeCell.column, direction),
    );
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
      if (commandId === "fillDown") {
        fillDown();
      } else if (commandId === "fillRight") {
        fillRight();
      } else if (commandId === "sortAscending") {
        sortRowsByActiveColumn("asc");
      } else if (commandId === "sortDescending") {
        sortRowsByActiveColumn("desc");
      } else if (commandId === "filter") {
        setFilterText((current) => (current ? "" : activeCellValue));
      } else {
        return false;
      }
      return true;
    },
  );

  useEffect(() => {
    if (!commandRequest || handledCommandTokenRef.current === commandRequest.token) return;
    handledCommandTokenRef.current = commandRequest.token;
    window.setTimeout(() => {
      if (handleCommandRequest(commandRequest.id)) {
        onCommandHandled?.(commandRequest);
      }
    }, 0);
  }, [commandRequest, onCommandHandled]);

  function addRow() {
    const insertAt = activeCell ? activeCell.row + 1 : sourceRows.length;
    const requiredColumns = Math.max(sourceColumnCount, (activeCell?.column ?? 0) + 1);
    const nextRows = ensureDelimitedRows(sourceRows, insertAt, requiredColumns);
    nextRows.splice(insertAt, 0, Array(requiredColumns).fill(""));
    commitDelimitedRows(nextRows);
    setActiveCell({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionAnchor({ row: insertAt, column: activeCell?.column ?? 0 });
    setSelectionEnd({ row: insertAt, column: activeCell?.column ?? 0 });
  }

  function addColumn() {
    const insertAt = activeCell ? activeCell.column + 1 : sourceColumnCount;
    const requiredColumns = Math.max(sourceColumnCount, insertAt);
    commitDelimitedRows(
      ensureDelimitedRows(sourceRows, Math.max(1, sourceRows.length), requiredColumns).map((row) => {
        const next = normalizeRow(row, requiredColumns);
        next.splice(insertAt, 0, "");
        return next;
      }),
    );
    setActiveCell({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionAnchor({ row: activeCell?.row ?? 0, column: insertAt });
    setSelectionEnd({ row: activeCell?.row ?? 0, column: insertAt });
  }

  function deleteActiveRow() {
    if (!activeCell || activeCell.row >= sourceRows.length || sourceRows.length <= 1) return;
    commitDelimitedRows(sourceRows.filter((_, index) => index !== activeCell.row));
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function deleteActiveColumn() {
    if (!activeCell || activeCell.column >= sourceColumnCount || sourceColumnCount <= 1) return;
    commitDelimitedRows(
      sourceRows.map((row) =>
        normalizeRow(row, sourceColumnCount).filter((_, index) => index !== activeCell.column),
      ),
    );
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.row, activeCell.column, "");
  }

  function selectReference(reference: string) {
    const range = xlsxRangeFromRef(reference.trim());
    if (!range) return;
    const clamped = clampCellRange(range, displayRowLimit, columnCount);
    setActiveCell({ row: clamped.top, column: clamped.left });
    setSelectionAnchor({ row: clamped.top, column: clamped.left });
    setSelectionEnd({ row: clamped.bottom, column: clamped.right });
    scrollCellIntoView(gridRef.current, clamped.top, clamped.left);
  }

  function focusCell(row: number, column: number) {
    selectCell({ row, column });
    scrollCellIntoView(gridRef.current, row, column);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-delimited-cell="${row}:${column}"]`,
      );
      input?.focus();
      input?.select();
    });
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    row: number,
    column: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (primary && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (primary && event.key.toLowerCase() === "d") {
      event.preventDefault();
      fillDown();
      return;
    }
    if (primary && event.key.toLowerCase() === "r") {
      event.preventDefault();
      fillRight();
      return;
    }
    if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row: Math.min(row + 1, displayRowLimit - 1), column }, true);
      return;
    }
    if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row: Math.max(row - 1, 0), column }, true);
      return;
    }
    if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.min(column + 1, columnCount - 1) }, true);
      return;
    }
    if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      selectCell({ row, column: Math.max(column - 1, 0) }, true);
      return;
    }
    if (primary && event.key === ";") {
      event.preventDefault();
      updateCell(
        row,
        column,
        event.shiftKey ? spreadsheetTimeStamp() : spreadsheetDateStamp(),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusCell(
        event.shiftKey ? Math.max(row - 1, 0) : Math.min(row + 1, displayRowLimit - 1),
        column,
      );
    } else if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const nextColumn = column + direction;
      if (nextColumn >= 0 && nextColumn < columnCount) {
        focusCell(row, nextColumn);
      } else if (!event.shiftKey && row < displayRowLimit - 1) {
        focusCell(row + 1, 0);
      } else if (event.shiftKey && row > 0) {
        focusCell(row - 1, columnCount - 1);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SpreadsheetToolbar
        activeCellLabel={
          selectionRange
            ? rangeToA1(selectionRange)
            : activeCell
              ? `${columnName(activeCell.column)}${activeCell.row + 1}`
              : "-"
        }
        activeCellValue={activeCellValue}
        activeCellDisabled={!activeCell}
        onActiveCellLabelChange={selectReference}
        onActiveCellChange={(value) => {
          if (!activeCell) return;
          updateCell(activeCell.row, activeCell.column, value);
        }}
        onAddRow={addRow}
        onAddColumn={addColumn}
        onDeleteRow={deleteActiveRow}
        onDeleteColumn={deleteActiveColumn}
        onClearCell={clearActiveCell}
        onCopySelection={() => void copySelection()}
        onFillDown={fillDown}
        onFillRight={fillRight}
        onSortAsc={() => sortRowsByActiveColumn("asc")}
        onSortDesc={() => sortRowsByActiveColumn("desc")}
        filterText={filterText}
        onFilterTextChange={setFilterText}
        canDeleteRow={Boolean(activeCell && activeCell.row < sourceRows.length && sourceRows.length > 1)}
        canDeleteColumn={Boolean(activeCell && activeCell.column < sourceColumnCount && sourceColumnCount > 1)}
        canClearCell={Boolean(activeCell)}
        canCopy={Boolean(selectionRange)}
        canFillDown={Boolean(selectionRange && selectionRange.bottom > selectionRange.top)}
        canFillRight={Boolean(selectionRange && selectionRange.right > selectionRange.left)}
        canSort={Boolean(activeCell)}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
        <span className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text-faint)]">
          {model.encoding ?? "utf-8"}
        </span>
        <label className="inline-flex items-center gap-1.5">
          Line ending
          <select
            value={delimitedLineEndingValue(model.lineEnding)}
            onChange={(event) => onChange({ ...model, lineEnding: event.target.value })}
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value={"\n"}>LF</option>
            <option value={"\r\n"}>CRLF</option>
            <option value={"\r"}>CR</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          Quote
          <select
            value={model.quoteStyle ?? "minimal"}
            onChange={(event) =>
              onChange({
                ...model,
                quoteStyle:
                  event.target.value === "always" ? "always" : "minimal",
              })
            }
            className="h-7 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="minimal">minimal</option>
            <option value="always">always</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
          <input
            type="checkbox"
            checked={model.bom === true}
            onChange={(event) => onChange({ ...model, bom: event.target.checked })}
          />
          BOM
        </label>
        <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1">
          <input
            type="checkbox"
            checked={model.trailingNewline === true}
            onChange={(event) =>
              onChange({ ...model, trailingNewline: event.target.checked })
            }
          />
          Final newline
        </label>
      </div>
      <div
        ref={gridRef}
        onScroll={(event) => setViewport(viewportFromElement(event.currentTarget))}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        <table className="border-collapse text-xs shadow-sm">
          <thead>
            <tr>
              <th
                onClick={selectAllCells}
                className={cn(
                  "sticky left-0 top-0 z-20 h-8 min-w-12 cursor-pointer border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                  rangeCoversSheet(selectionRange, displayRowLimit, columnCount) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
                title="Select all cells"
              />
              {columnWindow.start > 0 && (
                <th
                  aria-hidden="true"
                  className="sticky top-0 z-10 h-8 border border-transparent bg-[var(--surface)]"
                  style={{ minWidth: columnWindow.start * SPREADSHEET_COLUMN_WIDTH }}
                />
              )}
              {visibleColumnIndexes.map((columnIndex) => (
                <th
                  key={columnIndex}
                  onClick={() => selectColumn(columnIndex)}
                  className={cn(
                    "sticky top-0 z-10 h-8 min-w-32 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-center font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                    rangeCoversColumn(selectionRange, columnIndex, displayRowLimit) &&
                      "bg-[var(--accent)]/10 text-[var(--accent)]",
                  )}
                >
                  {columnName(columnIndex)}
                </th>
              ))}
              {columnWindow.end < columnCount && (
                <th
                  aria-hidden="true"
                  className="sticky top-0 z-10 h-8 border border-transparent bg-[var(--surface)]"
                  style={{ minWidth: (columnCount - columnWindow.end) * SPREADSHEET_COLUMN_WIDTH }}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {rowWindow.start > 0 && (
              <SpreadsheetSpacerRow
                height={rowWindow.start * SPREADSHEET_ROW_HEIGHT}
                columnSpan={visibleColumnIndexes.length + spacerColumnCount(columnWindow, columnCount)}
              />
            )}
            {visibleRows.slice(rowWindow.start, rowWindow.end).map(({ row, rowIndex }) => {
              const normalized = normalizeRow(row, columnCount);
              return (
                <tr key={rowIndex}>
                  <th
                    onClick={() => selectRow(rowIndex)}
                    className={cn(
                      "sticky left-0 z-10 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                      rangeCoversRow(selectionRange, rowIndex, columnCount) &&
                        "bg-[var(--accent)]/10 text-[var(--accent)]",
                    )}
                  >
                    {rowIndex + 1}
                  </th>
                  {columnWindow.start > 0 && (
                    <SpreadsheetColumnSpacer width={columnWindow.start * SPREADSHEET_COLUMN_WIDTH} />
                  )}
                  {normalized.slice(columnWindow.start, columnWindow.end).map((cell, offset) => {
                    const columnIndex = columnWindow.start + offset;
                    return (
                    <td
                      key={columnIndex}
                    className={spreadsheetCellClass(
                      activeCell,
                      selectionRange,
                      rowIndex,
                      columnIndex,
                    )}
                  >
                      <input
                        data-delimited-cell={`${rowIndex}:${columnIndex}`}
                        value={cell}
                        onChange={(event) =>
                          updateCell(rowIndex, columnIndex, event.target.value)
                        }
                        onFocus={() =>
                          setActiveCell({ row: rowIndex, column: columnIndex })
                        }
                        onMouseDown={(event) =>
                          selectCell(
                            { row: rowIndex, column: columnIndex },
                            event.shiftKey,
                          )
                        }
                        onMouseEnter={(event) => {
                          if (event.buttons === 1) {
                            selectCell({ row: rowIndex, column: columnIndex }, true);
                          }
                        }}
                        onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                        onPaste={(event) => {
                          const matrix = clipboardDataToMatrix(event.clipboardData);
                          if (matrix) {
                            event.preventDefault();
                            updateCellsFromMatrix(rowIndex, columnIndex, matrix);
                          }
                        }}
                        className="h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                        aria-label={t("documentEditor.cellLabel", {
                          row: rowIndex + 1,
                          column: columnIndex + 1,
                        })}
                        />
                      </td>
                    );
                  })}
                  {columnWindow.end < columnCount && (
                    <SpreadsheetColumnSpacer width={(columnCount - columnWindow.end) * SPREADSHEET_COLUMN_WIDTH} />
                  )}
                </tr>
              );
            })}
            {rowWindow.end < visibleRows.length && (
              <SpreadsheetSpacerRow
                height={(visibleRows.length - rowWindow.end) * SPREADSHEET_ROW_HEIGHT}
                columnSpan={visibleColumnIndexes.length + spacerColumnCount(columnWindow, columnCount)}
              />
            )}
          </tbody>
        </table>
      </div>
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}

function SpreadsheetToolbar({
  activeCellLabel,
  activeCellValue,
  activeCellDisabled,
  onActiveCellLabelChange,
  onActiveCellChange,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onDeleteColumn,
  onClearCell,
  onCopySelection,
  onFillDown,
  onFillRight,
  onSortAsc,
  onSortDesc,
  filterText,
  onFilterTextChange,
  autoFilter,
  onSetAutoFilter,
  onClearAutoFilter,
  showFormulas = false,
  onToggleShowFormulas,
  activeColumnWidth,
  activeRowHeight,
  onActiveColumnWidthChange,
  onActiveRowHeightChange,
  onHideRows,
  onHideColumns,
  onUnhideAll,
  frozenRows,
  frozenColumns,
  onFrozenRowsChange,
  onFrozenColumnsChange,
  onMergeCells,
  onUnmergeCells,
  activeDataValidation,
  onApplyDataValidation,
  activeConditionalRule,
  onApplyConditionalFormatting,
  activeHyperlink,
  onApplyHyperlink,
  activeComment,
  onApplyComment,
  sheetProtection,
  pageMargins,
  pageSetup,
  onSheetSettingsChange,
  activeCellStyle,
  onApplyCellStyle,
  onClearCellFormat,
  canDeleteRow,
  canDeleteColumn,
  canClearCell,
  canCopy,
  canFillDown,
  canFillRight,
  canSetAutoFilter = false,
  canMerge = false,
  canUnmerge = false,
  canValidate = false,
  canApplyConditionalFormatting = false,
  canApplyHyperlink = false,
  canApplyComment = false,
  canHide = false,
  canFormat = false,
  canSort,
}: {
  activeCellLabel: string;
  activeCellValue: string;
  activeCellDisabled: boolean;
  onActiveCellLabelChange: (value: string) => void;
  onActiveCellChange: (value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDeleteRow: () => void;
  onDeleteColumn: () => void;
  onClearCell: () => void;
  onCopySelection: () => void;
  onFillDown: () => void;
  onFillRight: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  autoFilter?: string;
  onSetAutoFilter?: () => void;
  onClearAutoFilter?: () => void;
  showFormulas?: boolean;
  onToggleShowFormulas?: () => void;
  activeColumnWidth?: number;
  activeRowHeight?: number;
  onActiveColumnWidthChange?: (value: number) => void;
  onActiveRowHeightChange?: (value: number) => void;
  onHideRows?: () => void;
  onHideColumns?: () => void;
  onUnhideAll?: () => void;
  frozenRows?: number;
  frozenColumns?: number;
  onFrozenRowsChange?: (value: number) => void;
  onFrozenColumnsChange?: (value: number) => void;
  onMergeCells?: () => void;
  onUnmergeCells?: () => void;
  activeDataValidation?: XlsxDataValidation;
  onApplyDataValidation?: (validation: XlsxDataValidation | null) => void;
  activeConditionalRule?: XlsxConditionalRule;
  onApplyConditionalFormatting?: (rule: XlsxConditionalRule | null) => void;
  activeHyperlink?: XlsxHyperlink;
  onApplyHyperlink?: (hyperlink: XlsxHyperlink | null) => void;
  activeComment?: XlsxComment;
  onApplyComment?: (comment: XlsxComment | null) => void;
  sheetProtection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  onSheetSettingsChange?: (patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) => void;
  activeCellStyle?: XlsxCellStylePatch;
  onApplyCellStyle?: (patch: XlsxCellStylePatch) => void;
  onClearCellFormat?: () => void;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
  canClearCell: boolean;
  canCopy: boolean;
  canFillDown: boolean;
  canFillRight: boolean;
  canSetAutoFilter?: boolean;
  canMerge?: boolean;
  canUnmerge?: boolean;
  canValidate?: boolean;
  canApplyConditionalFormatting?: boolean;
  canApplyHyperlink?: boolean;
  canApplyComment?: boolean;
  canHide?: boolean;
  canFormat?: boolean;
  canSort: boolean;
}) {
  const { t } = useTranslation();
  const numberFormat = activeCellStyle?.numberFormat ?? "";
  const fontSize = activeCellStyle?.fontSize ?? "11";
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false);
  const [formulaSuggestionIndex, setFormulaSuggestionIndex] = useState(0);
  const formulaSuggestions = spreadsheetFormulaSuggestions(activeCellValue);
  const formulaPopoverOpen =
    formulaHelpOpen && !activeCellDisabled && formulaSuggestions.length > 0;

  function applyFormulaSuggestion(suggestion: SpreadsheetFormulaFunction) {
    onActiveCellChange(
      applySpreadsheetFormulaSuggestion(activeCellValue, suggestion.name),
    );
    setFormulaHelpOpen(false);
    setFormulaSuggestionIndex(0);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = data.get("cellReference");
          if (typeof value === "string") onActiveCellLabelChange(value);
        }}
      >
        <input
          key={activeCellLabel}
          name="cellReference"
          defaultValue={activeCellLabel}
          className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:text-[var(--text)]"
          aria-label={t("documentEditor.nameBox", {
            defaultValue: "Name box",
          })}
        />
      </form>
      <div className="relative min-w-72 flex-1">
        <input
          value={activeCellValue}
          onChange={(event) => {
            onActiveCellChange(event.target.value);
            setFormulaHelpOpen(true);
            setFormulaSuggestionIndex(0);
          }}
          onFocus={() => setFormulaHelpOpen(true)}
          onBlur={() => setFormulaHelpOpen(false)}
          onKeyDown={(event) => {
            if (!formulaPopoverOpen) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) =>
                Math.min(current + 1, formulaSuggestions.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              applyFormulaSuggestion(
                formulaSuggestions[
                  Math.min(formulaSuggestionIndex, formulaSuggestions.length - 1)
                ],
              );
            } else if (event.key === "Escape") {
              setFormulaHelpOpen(false);
            }
          }}
          disabled={activeCellDisabled}
          className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={t("documentEditor.formulaBar", { defaultValue: "Formula bar" })}
          aria-autocomplete="list"
        />
        {formulaPopoverOpen && (
          <div className="absolute left-0 right-0 top-9 z-30 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
            {formulaSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyFormulaSuggestion(suggestion);
                }}
                onMouseEnter={() => setFormulaSuggestionIndex(index)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left",
                  index === formulaSuggestionIndex
                    ? "bg-[var(--accent)]/10"
                    : "hover:bg-[var(--surface-hover)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    {suggestion.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {suggestion.signature}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--text-faint)]">
                    {suggestion.category}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-faint)]">
                  {suggestion.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {onToggleShowFormulas && (
        <button
          type="button"
          onClick={onToggleShowFormulas}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            showFormulas && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={t("documentEditor.toggleFormulas", {
            defaultValue: "Toggle formulas",
          })}
        >
          <Sigma className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      {onApplyCellStyle && (
        <>
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
          <select
            value={
              XLSX_NUMBER_FORMATS.some((item) => item.value === numberFormat)
                ? numberFormat
                : "__custom"
            }
            onChange={(event) =>
              onApplyCellStyle({
                numberFormat:
                  event.currentTarget.value === "__custom"
                    ? numberFormat
                    : event.currentTarget.value || undefined,
              })
            }
            disabled={!canFormat}
            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            title={t("documentEditor.numberFormat", {
              defaultValue: "Number format",
            })}
          >
            {XLSX_NUMBER_FORMATS.map((item) => (
              <option key={item.label} value={item.value}>
                {item.label}
              </option>
            ))}
            {!XLSX_NUMBER_FORMATS.some((item) => item.value === numberFormat) && (
              <option value="__custom">{numberFormat}</option>
            )}
          </select>
          <FontFamilySelect
            value={activeCellStyle?.fontFamily}
            compact
            onChange={(fontFamily) => onApplyCellStyle({ fontFamily })}
          />
          <select
            value={XLSX_FONT_SIZES.includes(fontSize) ? fontSize : "__custom"}
            onChange={(event) =>
              onApplyCellStyle({
                fontSize:
                  event.currentTarget.value === "__custom"
                    ? fontSize
                    : event.currentTarget.value,
              })
            }
            disabled={!canFormat}
            className="h-8 w-16 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            title={t("documentEditor.fontSize", { defaultValue: "Font size" })}
          >
            {XLSX_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            {!XLSX_FONT_SIZES.includes(fontSize) && (
              <option value="__custom">{fontSize}</option>
            )}
          </select>
          <SpreadsheetIconButton
            icon={Bold}
            label={t("documentEditor.bold", { defaultValue: "Bold" })}
            active={activeCellStyle?.bold === true}
            disabled={!canFormat}
            onClick={() => onApplyCellStyle({ bold: !activeCellStyle?.bold })}
          />
          <SpreadsheetIconButton
            icon={Italic}
            label={t("documentEditor.italic", { defaultValue: "Italic" })}
            active={activeCellStyle?.italic === true}
            disabled={!canFormat}
            onClick={() => onApplyCellStyle({ italic: !activeCellStyle?.italic })}
          />
          <SpreadsheetIconButton
            icon={Underline}
            label={t("documentEditor.underline", { defaultValue: "Underline" })}
            active={activeCellStyle?.underline === true}
            disabled={!canFormat}
            onClick={() =>
              onApplyCellStyle({ underline: !activeCellStyle?.underline })
            }
          />
          <SpreadsheetIconButton
            icon={Strikethrough}
            label={t("documentEditor.strikethrough", {
              defaultValue: "Strikethrough",
            })}
            active={activeCellStyle?.strikethrough === true}
            disabled={!canFormat}
            onClick={() =>
              onApplyCellStyle({
                strikethrough: !activeCellStyle?.strikethrough,
              })
            }
          />
          <label
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              !canFormat && "pointer-events-none opacity-50",
            )}
            title={t("documentEditor.textColor", { defaultValue: "Text color" })}
          >
            <Palette className="h-3.5 w-3.5" strokeWidth={1.75} />
            <input
              type="color"
              value={activeCellStyle?.color ?? "#111827"}
              onChange={(event) => onApplyCellStyle({ color: event.target.value })}
              className="sr-only"
              disabled={!canFormat}
            />
          </label>
          <label
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              !canFormat && "pointer-events-none opacity-50",
            )}
            title={t("documentEditor.fillColor", { defaultValue: "Fill color" })}
          >
            <PaintBucket className="h-3.5 w-3.5" strokeWidth={1.75} />
            <input
              type="color"
              value={activeCellStyle?.fillColor ?? "#ffffff"}
              onChange={(event) =>
                onApplyCellStyle({ fillColor: event.target.value })
              }
              className="sr-only"
              disabled={!canFormat}
            />
          </label>
          <SpreadsheetIconButton
            icon={AlignLeft}
            label={t("documentEditor.alignLeft", { defaultValue: "Align left" })}
            active={activeCellStyle?.align === "left"}
            disabled={!canFormat}
            onClick={() => onApplyCellStyle({ align: "left" })}
          />
          <SpreadsheetIconButton
            icon={AlignCenter}
            label={t("documentEditor.alignCenter", {
              defaultValue: "Align center",
            })}
            active={activeCellStyle?.align === "center"}
            disabled={!canFormat}
            onClick={() => onApplyCellStyle({ align: "center" })}
          />
          <SpreadsheetIconButton
            icon={AlignRight}
            label={t("documentEditor.alignRight", {
              defaultValue: "Align right",
            })}
            active={activeCellStyle?.align === "right"}
            disabled={!canFormat}
            onClick={() => onApplyCellStyle({ align: "right" })}
          />
          <SpreadsheetIconButton
            icon={WrapText}
            label={t("documentEditor.wrapText", { defaultValue: "Wrap text" })}
            active={activeCellStyle?.wrapText === true}
            disabled={!canFormat}
            onClick={() =>
              onApplyCellStyle({ wrapText: !activeCellStyle?.wrapText })
            }
          />
          {onClearCellFormat && (
            <button
              type="button"
              onClick={onClearCellFormat}
              disabled={!canFormat}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("documentEditor.clearFormat", {
                defaultValue: "Clear format",
              })}
            </button>
          )}
          <div className="mx-1 h-5 w-px bg-[var(--border)]" />
        </>
      )}
      {onActiveColumnWidthChange && activeColumnWidth !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.columnWidth")}</span>
          <input
            type="number"
            min={4}
            max={80}
            step={0.5}
            value={activeColumnWidth}
            onChange={(event) =>
              onActiveColumnWidthChange(Number(event.currentTarget.value))
            }
            className="h-6 w-14 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onActiveRowHeightChange && activeRowHeight !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.rowHeight")}</span>
          <input
            type="number"
            min={8}
            max={180}
            step={1}
            value={activeRowHeight}
            onChange={(event) =>
              onActiveRowHeightChange(Number(event.currentTarget.value))
            }
            className="h-6 w-14 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onMergeCells && (
        <button
          type="button"
          onClick={onMergeCells}
          disabled={!canMerge}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.mergeCells")}
        </button>
      )}
      {onUnmergeCells && (
        <button
          type="button"
          onClick={onUnmergeCells}
          disabled={!canUnmerge}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.unmergeCells")}
        </button>
      )}
      {onApplyDataValidation && (
        <SpreadsheetValidationControls
          validation={activeDataValidation}
          disabled={!canValidate}
          onChange={onApplyDataValidation}
        />
      )}
      {onApplyConditionalFormatting && (
        <SpreadsheetConditionalFormattingControls
          rule={activeConditionalRule}
          disabled={!canApplyConditionalFormatting}
          onChange={onApplyConditionalFormatting}
        />
      )}
      {onApplyHyperlink && (
        <SpreadsheetHyperlinkControls
          hyperlink={activeHyperlink}
          disabled={!canApplyHyperlink}
          onChange={onApplyHyperlink}
        />
      )}
      {onApplyComment && (
        <SpreadsheetCommentControls
          comment={activeComment}
          disabled={!canApplyComment}
          onChange={onApplyComment}
        />
      )}
      {onSheetSettingsChange && (
        <SpreadsheetSheetSettingsControls
          protection={sheetProtection}
          pageMargins={pageMargins}
          pageSetup={pageSetup}
          onChange={onSheetSettingsChange}
        />
      )}
      {onHideRows && (
        <button
          type="button"
          onClick={onHideRows}
          disabled={!canHide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.hideRows")}
        </button>
      )}
      {onHideColumns && (
        <button
          type="button"
          onClick={onHideColumns}
          disabled={!canHide}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.hideColumns")}
        </button>
      )}
      {onUnhideAll && (
        <button
          type="button"
          onClick={onUnhideAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.unhideAll")}
        </button>
      )}
      {onFrozenRowsChange && frozenRows !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.frozenRows", { defaultValue: "Frozen rows" })}</span>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={frozenRows}
            onChange={(event) =>
              onFrozenRowsChange(Number(event.currentTarget.value))
            }
            className="h-6 w-12 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      {onFrozenColumnsChange && frozenColumns !== undefined && (
        <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)]">
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{t("documentEditor.frozenColumns", { defaultValue: "Frozen columns" })}</span>
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={frozenColumns}
            onChange={(event) =>
              onFrozenColumnsChange(Number(event.currentTarget.value))
            }
            className="h-6 w-12 bg-transparent text-right text-[var(--text)] outline-none"
          />
        </label>
      )}
      <button
        type="button"
        onClick={onAddRow}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addRow")}
      </button>
      <button
        type="button"
        onClick={onAddColumn}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {t("documentEditor.addColumn")}
      </button>
      <button
        type="button"
        onClick={onCopySelection}
        disabled={!canCopy}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.copyRange", { defaultValue: "Copy range" })}
      >
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillDown}
        disabled={!canFillDown}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillDown", { defaultValue: "Fill down" })}
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onFillRight}
        disabled={!canFillRight}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title={t("documentEditor.fillRight", { defaultValue: "Fill right" })}
      >
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortAsc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort ascending"
      >
        <ArrowUpAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onSortDesc}
        disabled={!canSort}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Sort descending"
      >
        <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {onSetAutoFilter && (
        <button
          type="button"
          onClick={onSetAutoFilter}
          disabled={!canSetAutoFilter}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40",
            autoFilter && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={
            autoFilter
              ? `Saved XLSX filter range: ${autoFilter}`
              : "Set XLSX filter range"
          }
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
          {autoFilter ?? "Set filter"}
        </button>
      )}
      {onClearAutoFilter && autoFilter && (
        <button
          type="button"
          onClick={onClearAutoFilter}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Clear XLSX filter range"
        >
          <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      <div className="flex h-8 min-w-44 items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2">
        <Filter className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" strokeWidth={1.75} />
        <input
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          placeholder="Filter rows"
        />
        {filterText && (
          <button
            type="button"
            onClick={() => onFilterTextChange("")}
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title="Clear filter"
          >
            <FilterX className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClearCell}
        disabled={!canClearCell}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Clear cell"
      >
        <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteRow}
        disabled={!canDeleteRow}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete row"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onDeleteColumn}
        disabled={!canDeleteColumn}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Delete column"
      >
        <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function SpreadsheetValidationControls({
  validation,
  disabled,
  onChange,
}: {
  validation?: XlsxDataValidation;
  disabled: boolean;
  onChange: (validation: XlsxDataValidation | null) => void;
}) {
  const type = validation?.type ?? "";
  const operator = validation?.operator ?? "between";

  function patchValidation(patch: Partial<XlsxDataValidation>) {
    const nextType = patch.type ?? validation?.type ?? "list";
    onChange({
      sqref: validation?.sqref ?? "",
      type: nextType,
      operator:
        nextType === "list" || nextType === "custom"
          ? undefined
          : (patch.operator ?? validation?.operator ?? "between"),
      formula1: patch.formula1 ?? validation?.formula1,
      formula2:
        nextType === "list" || nextType === "custom"
          ? undefined
          : (patch.formula2 ?? validation?.formula2),
      allowBlank: patch.allowBlank ?? validation?.allowBlank ?? true,
      showInputMessage:
        patch.showInputMessage ?? validation?.showInputMessage ?? false,
      showErrorMessage:
        patch.showErrorMessage ?? validation?.showErrorMessage ?? true,
      promptTitle: patch.promptTitle ?? validation?.promptTitle,
      prompt: patch.prompt ?? validation?.prompt,
      errorTitle: patch.errorTitle ?? validation?.errorTitle,
      error: patch.error ?? validation?.error,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <select
        value={type}
        disabled={disabled}
        onChange={(event) => {
          const nextType = event.currentTarget.value as "" | XlsxDataValidationType;
          if (!nextType) {
            onChange(null);
            return;
          }
          patchValidation({
            type: nextType,
            formula1:
              nextType === "list"
                ? (validation?.formula1 ?? '"Option 1,Option 2"')
                : validation?.formula1,
          });
        }}
        className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Data validation"
      >
        {XLSX_VALIDATION_TYPES.map((item) => (
          <option key={item.label} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {type && type !== "list" && type !== "custom" && (
        <select
          value={operator}
          disabled={disabled}
          onChange={(event) =>
            patchValidation({
              operator: event.currentTarget.value as XlsxDataValidationOperator,
            })
          }
          className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          title="Validation operator"
        >
          {XLSX_VALIDATION_OPERATORS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {type && (
        <input
          value={validation?.formula1 ?? ""}
          disabled={disabled}
          onChange={(event) => patchValidation({ formula1: event.target.value })}
          className="h-7 w-40 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={
            type === "list"
              ? '"A,B,C" or =$A$1:$A$3'
              : type === "custom"
                ? "=A1>0"
                : "Formula 1"
          }
          title="Validation formula 1"
        />
      )}
      {type &&
        type !== "list" &&
        type !== "custom" &&
        (operator === "between" || operator === "notBetween") && (
          <input
            value={validation?.formula2 ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ formula2: event.target.value })}
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Formula 2"
            title="Validation formula 2"
          />
        )}
      {type && (
        <>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={validation?.allowBlank ?? true}
              disabled={disabled}
              onChange={(event) =>
                patchValidation({ allowBlank: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Blank
          </label>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={validation?.showErrorMessage ?? true}
              disabled={disabled}
              onChange={(event) =>
                patchValidation({
                  showErrorMessage: event.currentTarget.checked,
                })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Error
          </label>
          <input
            value={validation?.errorTitle ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ errorTitle: event.target.value })}
            className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Error title"
            title="Validation error title"
          />
          <input
            value={validation?.error ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ error: event.target.value })}
            className="h-7 w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Error message"
            title="Validation error message"
          />
        </>
      )}
    </div>
  );
}

function SpreadsheetConditionalFormattingControls({
  rule,
  disabled,
  onChange,
}: {
  rule?: XlsxConditionalRule;
  disabled: boolean;
  onChange: (rule: XlsxConditionalRule | null) => void;
}) {
  const type = rule?.type ?? "";
  const operator = rule?.operator ?? "greaterThan";
  const formulas = rule?.formulas ?? [];
  const fillColor = rule?.fillColor ?? "#e7f5d8";

  function patchRule(patch: Partial<XlsxConditionalRule>) {
    const nextType = patch.type ?? rule?.type ?? "cellIs";
    const nextOperator =
      nextType === "cellIs"
        ? (patch.operator ?? rule?.operator ?? "greaterThan")
        : undefined;
    const nextFormulas =
      patch.formulas ??
      rule?.formulas ??
      (nextType === "expression" ? ["=A1>0"] : [""]);
    onChange({
      type: nextType,
      operator: nextOperator,
      formulas:
        nextType === "duplicateValues" ||
        nextType === "blanks" ||
        nextType === "errors"
          ? undefined
          : nextFormulas,
      text:
        nextType === "containsText"
          ? (patch.text ?? rule?.text ?? nextFormulas[0] ?? "")
          : undefined,
      fillColor: patch.fillColor ?? rule?.fillColor ?? fillColor,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <select
        value={type}
        disabled={disabled}
        onChange={(event) => {
          const nextType = event.currentTarget.value as "" | XlsxConditionalRuleType;
          if (!nextType) {
            onChange(null);
            return;
          }
          patchRule({
            type: nextType,
            formulas:
              nextType === "expression"
                ? (rule?.formulas ?? ["=A1>0"])
                : rule?.formulas,
          });
        }}
        className="h-7 w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Conditional formatting"
      >
        {XLSX_CONDITIONAL_RULE_TYPES.map((item) => (
          <option key={item.label} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {type === "cellIs" && (
        <select
          value={operator}
          disabled={disabled}
          onChange={(event) =>
            patchRule({
              operator: event.currentTarget.value as XlsxConditionalOperator,
            })
          }
          className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          title="Conditional operator"
        >
          {XLSX_CONDITIONAL_OPERATORS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {(type === "cellIs" ||
        type === "expression" ||
        type === "containsText") && (
        <input
          value={type === "containsText" ? (rule?.text ?? "") : (formulas[0] ?? "")}
          disabled={disabled}
          onChange={(event) =>
            patchRule({
              formulas: [event.target.value],
              text: event.target.value,
            })
          }
          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={
            type === "expression"
              ? "=A1>0"
              : type === "containsText"
                ? "Text"
                : "Value"
          }
          title="Conditional formula or text"
        />
      )}
      {type === "cellIs" &&
        (operator === "between" || operator === "notBetween") && (
          <input
            value={formulas[1] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchRule({
                formulas: [formulas[0] ?? "", event.target.value],
              })
            }
            className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Value 2"
            title="Second conditional value"
          />
        )}
      {type && (
        <label
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
            disabled && "pointer-events-none opacity-50",
          )}
          title="Conditional fill color"
        >
          <PaintBucket className="h-3.5 w-3.5" strokeWidth={1.75} />
          <input
            type="color"
            value={fillColor}
            disabled={disabled}
            onChange={(event) => patchRule({ fillColor: event.target.value })}
            className="sr-only"
          />
        </label>
      )}
    </div>
  );
}

function SpreadsheetHyperlinkControls({
  hyperlink,
  disabled,
  onChange,
}: {
  hyperlink?: XlsxHyperlink;
  disabled: boolean;
  onChange: (hyperlink: XlsxHyperlink | null) => void;
}) {
  const mode = hyperlink?.location ? "location" : hyperlink?.target ? "target" : "";

  function patchHyperlink(
    patch: Partial<XlsxHyperlink>,
    nextMode: "target" | "location" = mode === "location" ? "location" : "target",
  ) {
    const display = optionalTrimmedString(
      patch.display ?? hyperlink?.display,
    );
    const tooltip = optionalTrimmedString(
      patch.tooltip ?? hyperlink?.tooltip,
    );
    if (nextMode === "location") {
      const location = optionalTrimmedString(
        patch.location ?? hyperlink?.location ?? "Sheet1!A1",
      );
      if (!location) {
        onChange(null);
        return;
      }
      onChange({
        ref: hyperlink?.ref ?? "",
        location,
        display,
        tooltip,
      });
      return;
    }
    const target = optionalTrimmedString(
      patch.target ?? hyperlink?.target ?? "https://",
    );
    if (!target) {
      onChange(null);
      return;
    }
    onChange({
      ref: hyperlink?.ref ?? "",
      target,
      display,
      tooltip,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <Link className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          const nextMode = event.currentTarget.value as "" | "target" | "location";
          if (!nextMode) {
            onChange(null);
            return;
          }
          patchHyperlink({}, nextMode);
        }}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Hyperlink"
      >
        <option value="">No link</option>
        <option value="target">URL</option>
        <option value="location">Sheet</option>
      </select>
      {mode === "target" && (
        <input
          value={hyperlink?.target ?? ""}
          disabled={disabled}
          onChange={(event) => patchHyperlink({ target: event.target.value }, "target")}
          className="h-7 w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="https://example.com"
          title="Hyperlink target URL"
        />
      )}
      {mode === "location" && (
        <input
          value={hyperlink?.location ?? ""}
          disabled={disabled}
          onChange={(event) =>
            patchHyperlink({ location: event.target.value }, "location")
          }
          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="Sheet1!A1"
          title="Hyperlink sheet location"
        />
      )}
      {mode && (
        <>
          <input
            value={hyperlink?.display ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ display: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Display"
            title="Hyperlink display text"
          />
          <input
            value={hyperlink?.tooltip ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ tooltip: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Tooltip"
            title="Hyperlink tooltip"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Remove hyperlink"
          >
            <Unlink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );
}

function SpreadsheetCommentControls({
  comment,
  disabled,
  onChange,
}: {
  comment?: XlsxComment;
  disabled: boolean;
  onChange: (comment: XlsxComment | null) => void;
}) {
  function patchComment(patch: Partial<XlsxComment>) {
    const text = patch.text ?? comment?.text ?? "";
    if (!text.trim()) {
      onChange(null);
      return;
    }
    onChange({
      ref: comment?.ref ?? "",
      author: optionalTrimmedString(patch.author ?? comment?.author),
      text,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <MessageSquare className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <input
        value={comment?.author ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ author: event.target.value })}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Author"
        title="Comment author"
      />
      <textarea
        value={comment?.text ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ text: event.target.value })}
        className="h-7 w-48 resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Comment"
        title="Cell comment"
      />
      {comment && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Remove comment"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function SpreadsheetSheetSettingsControls({
  protection,
  pageMargins,
  pageSetup,
  onChange,
}: {
  protection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  onChange: (patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) => void;
}) {
  const margins = pageMargins ?? {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0.3,
    footer: 0.3,
  };
  const setup: XlsxPageSetup = pageSetup ?? {
    orientation: "portrait",
    paperSize: 9,
    scale: 100,
  };

  function updateProtection(patch: Partial<XlsxSheetProtection>) {
    const enabled = patch.enabled ?? protection?.enabled ?? false;
    onChange({
      protection: enabled
        ? {
            enabled,
            password: protection?.password,
            objects: patch.objects ?? protection?.objects ?? true,
            scenarios: patch.scenarios ?? protection?.scenarios ?? true,
            formatCells: patch.formatCells ?? protection?.formatCells ?? false,
            formatColumns:
              patch.formatColumns ?? protection?.formatColumns ?? false,
            formatRows: patch.formatRows ?? protection?.formatRows ?? false,
            insertColumns:
              patch.insertColumns ?? protection?.insertColumns ?? false,
            insertRows: patch.insertRows ?? protection?.insertRows ?? false,
            insertHyperlinks:
              patch.insertHyperlinks ?? protection?.insertHyperlinks ?? false,
            deleteColumns:
              patch.deleteColumns ?? protection?.deleteColumns ?? false,
            deleteRows: patch.deleteRows ?? protection?.deleteRows ?? false,
            sort: patch.sort ?? protection?.sort ?? false,
            autoFilter: patch.autoFilter ?? protection?.autoFilter ?? false,
            pivotTables: patch.pivotTables ?? protection?.pivotTables ?? false,
          }
        : undefined,
    });
  }

  function updateMargins(patch: Partial<XlsxPageMargins>) {
    onChange({ pageMargins: { ...margins, ...patch } });
  }

  function updateSetup(patch: Partial<XlsxPageSetup>) {
    onChange({ pageSetup: { ...setup, ...patch } });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <label className="inline-flex h-7 items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={protection?.enabled === true}
          onChange={(event) =>
            updateProtection({ enabled: event.currentTarget.checked })
          }
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
        Protect
      </label>
      {protection?.enabled && (
        <>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.autoFilter === true}
              onChange={(event) =>
                updateProtection({ autoFilter: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Filter
          </label>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.sort === true}
              onChange={(event) =>
                updateProtection({ sort: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Sort
          </label>
        </>
      )}
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <Printer className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={setup.orientation ?? "portrait"}
        onChange={(event) =>
          updateSetup({
            orientation: event.currentTarget.value as XlsxPageSetup["orientation"],
          })
        }
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title="Print orientation"
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Scale
        <input
          type="number"
          min={10}
          max={400}
          step={5}
          value={setup.scale ?? 100}
          onChange={(event) => updateSetup({ scale: Number(event.target.value) })}
          className="h-6 w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Margin
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.left ?? 0.7}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ left: value, right: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Left and right margins"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Top
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.top ?? 0.75}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ top: value, bottom: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Top and bottom margins"
        />
      </label>
    </div>
  );
}

function SpreadsheetStatusBar({
  summary,
}: {
  summary: { cells: number; numeric: number; sum: number; average: number | null };
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
      <span>Cells {summary.cells}</span>
      <span>Count {summary.numeric}</span>
      <span>Sum {formatNumber(summary.sum)}</span>
      <span>Average {summary.average === null ? "-" : formatNumber(summary.average)}</span>
    </div>
  );
}

function delimitedLineEndingValue(value: string | undefined) {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}

function SpreadsheetIconButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40",
        active && "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

function SpreadsheetObjectStrip({
  sheet,
  onChartTitleChange,
  onChartSeriesNameChange,
  onChartPointChange,
  onPivotNameChange,
}: {
  sheet: XlsxSheet | undefined;
  onChartTitleChange: (chartId: string, title: string) => void;
  onChartSeriesNameChange: (
    chartId: string,
    seriesIndex: number,
    value: string,
  ) => void;
  onChartPointChange: (
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
  onPivotNameChange: (pivotId: string, name: string) => void;
}) {
  const tables = sheet?.tables ?? [];
  const charts = sheet?.charts ?? [];
  const images = sheet?.images ?? [];
  const pivots = sheet?.pivots ?? [];
  if (
    tables.length === 0 &&
    charts.length === 0 &&
    images.length === 0 &&
    pivots.length === 0
  ) {
    return null;
  }
  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {tables.map((table) => (
          <SpreadsheetObjectChip
            key={`table:${table.id}:${table.path ?? ""}`}
            icon={Table}
            label={xlsxTableLabel(table)}
            detail={xlsxTableDetail(table)}
          />
        ))}
        {charts.map((chart) => (
          <SpreadsheetObjectChip
            key={`chart:${chart.id}:${chart.path ?? ""}`}
            icon={BarChart3}
            label={xlsxChartLabel(chart)}
            detail={xlsxAnchorLabel(chart.anchor)}
          />
        ))}
        {images.map((image) => (
          <SpreadsheetImageChip
            key={`image:${image.id}:${image.mediaPath ?? ""}`}
            image={image}
          />
        ))}
        {pivots.map((pivot) => (
          <SpreadsheetObjectChip
            key={`pivot:${pivot.id}:${pivot.path ?? ""}`}
            icon={Table}
            label={xlsxPivotLabel(pivot)}
            detail={pivot.path}
          />
        ))}
      </div>
      {(charts.length > 0 || pivots.length > 0) && (
        <div className="max-h-64 overflow-auto border-t border-[var(--border)] px-3 py-2">
          <div className="grid gap-2">
            {charts.map((chart) => (
              <SpreadsheetChartEditor
                key={`chart-editor:${chart.id}:${chart.path ?? ""}`}
                chart={chart}
                onTitleChange={(title) => onChartTitleChange(chart.id, title)}
                onSeriesNameChange={(seriesIndex, value) =>
                  onChartSeriesNameChange(chart.id, seriesIndex, value)
                }
                onPointChange={(seriesIndex, pointIndex, key, value) =>
                  onChartPointChange(chart.id, seriesIndex, pointIndex, key, value)
                }
              />
            ))}
            {pivots.map((pivot) => (
              <SpreadsheetPivotEditor
                key={`pivot-editor:${pivot.id}:${pivot.path ?? ""}`}
                pivot={pivot}
                onNameChange={(name) => onPivotNameChange(pivot.id, name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SpreadsheetPivotEditor({
  pivot,
  onNameChange,
}: {
  pivot: XlsxPivot;
  onNameChange: (name: string) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Pivot name
          </span>
          <input
            value={pivot.name ?? ""}
            onChange={(event) => onNameChange(event.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-end text-[11px] text-[var(--text-muted)]">
          {pivot.cacheId ? `cache ${pivot.cacheId}` : pivot.path}
        </div>
      </div>
    </div>
  );
}

function SpreadsheetChartEditor({
  chart,
  onTitleChange,
  onSeriesNameChange,
  onPointChange,
}: {
  chart: XlsxChart;
  onTitleChange: (title: string) => void;
  onSeriesNameChange: (seriesIndex: number, value: string) => void;
  onPointChange: (
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="mb-2 grid gap-2 md:grid-cols-[minmax(12rem,1fr)_auto]">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Chart title
          </span>
          <input
            value={chart.title ?? ""}
            onChange={(event) => onTitleChange(event.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex items-end text-[11px] text-[var(--text-muted)]">
          {chart.type ?? "chart"}
        </div>
      </div>
      {(chart.series ?? []).length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] px-2 py-1 text-[var(--text-muted)]">
          No chart data
        </div>
      ) : (
        <div className="grid gap-2">
          {(chart.series ?? []).map((series, seriesIndex) => {
            const rowCount = Math.max(
              series.categories?.length ?? 0,
              series.values?.length ?? 0,
              chart.categories?.length ?? 0,
            );
            return (
              <div key={`${series.name ?? "series"}-${seriesIndex}`}>
                <input
                  value={series.name ?? ""}
                  onChange={(event) =>
                    onSeriesNameChange(seriesIndex, event.target.value)
                  }
                  className="mb-1 h-7 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="text-left text-[11px] text-[var(--text-muted)]">
                      <th className="border border-[var(--border)] px-2 py-1 font-medium">
                        Category
                      </th>
                      <th className="border border-[var(--border)] px-2 py-1 font-medium">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: rowCount }).map((_, pointIndex) => (
                      <tr key={pointIndex}>
                        <td className="border border-[var(--border)] p-0">
                          <input
                            value={
                              series.categories?.[pointIndex] ??
                              chart.categories?.[pointIndex] ??
                              ""
                            }
                            onChange={(event) =>
                              onPointChange(
                                seriesIndex,
                                pointIndex,
                                "categories",
                                event.target.value,
                              )
                            }
                            className="h-7 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                          />
                        </td>
                        <td className="border border-[var(--border)] p-0">
                          <input
                            value={series.values?.[pointIndex] ?? ""}
                            onChange={(event) =>
                              onPointChange(
                                seriesIndex,
                                pointIndex,
                                "values",
                                event.target.value,
                              )
                            }
                            className="h-7 w-full bg-transparent px-2 text-xs text-[var(--text)] outline-none focus:bg-[var(--surface-hover)]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpreadsheetObjectChip({
  icon: Icon,
  label,
  detail,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail?: string;
}) {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
      title={[label, detail].filter(Boolean).join(" · ")}
    >
      <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="max-w-44 truncate text-[var(--text)]">{label}</div>
        {detail && (
          <div className="max-w-44 truncate text-[10px] text-[var(--text-faint)]">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function SpreadsheetImageChip({ image }: { image: XlsxImage }) {
  const anchor = xlsxAnchorLabel(image.anchor);
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
      title={[image.mediaPath, anchor].filter(Boolean).join(" · ")}
    >
      {image.dataUrl ? (
        <img
          src={image.dataUrl}
          alt=""
          className="h-7 w-7 rounded border border-[var(--border)] object-cover"
        />
      ) : (
        <ImageIcon className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
      )}
      <div className="min-w-0">
        <div className="max-w-44 truncate text-[var(--text)]">
          {image.mediaPath ?? image.id}
        </div>
        {anchor && (
          <div className="max-w-44 truncate text-[10px] text-[var(--text-faint)]">
            {anchor}
          </div>
        )}
      </div>
    </div>
  );
}

function SpreadsheetSpacerRow({
  height,
  columnSpan,
}: {
  height: number;
  columnSpan: number;
}) {
  return (
    <tr aria-hidden="true" style={{ height }}>
      <th className="sticky left-0 z-10 border-0 bg-[var(--surface)] p-0" />
      <td className="border-0 p-0" colSpan={Math.max(1, columnSpan)} />
    </tr>
  );
}

function SpreadsheetColumnSpacer({ width }: { width: number }) {
  return (
    <td
      aria-hidden="true"
      className="border border-transparent p-0"
      style={{ minWidth: width, width }}
    />
  );
}

function spreadsheetCellClass(
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

function xlsxMergedCellClass(
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

function valuesFromXlsxRange(
  sheet: XlsxSheet,
  columnCount: number,
  range: NormalizedCellRange,
  showFormulas = false,
) {
  return sheet.rows.slice(range.top, range.bottom + 1).map((row, rowOffset) =>
    normalizeXlsxCells(
      row.cells,
      columnCount,
      row.index || String(range.top + rowOffset + 1),
    )
      .slice(range.left, range.right + 1)
      .map((cell) => displayXlsxCellValue(cell, showFormulas)),
  );
}

function valuesFromDelimitedRange(
  rows: string[][],
  columnCount: number,
  range: NormalizedCellRange,
) {
  return rows.slice(range.top, range.bottom + 1).map((row) =>
    normalizeRow(row, columnCount).slice(range.left, range.right + 1),
  );
}

function summarizeSelection(values: string[][]) {
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

function rangeToClipboardText(values: string[][]) {
  return values
    .map((row) =>
      row
        .map((cell) =>
          cell.includes("\t") || /\r?\n/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join("\t"),
    )
    .join("\n");
}

function clipboardTextToMatrix(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((row) => row.split("\t"));
}

function clipboardDataToMatrix(data: DataTransfer) {
  const html = data.getData("text/html");
  const htmlMatrix = html ? htmlTableToMatrix(html) : null;
  if (htmlMatrix) return htmlMatrix;
  const text = data.getData("text/plain");
  if (!text.includes("\t") && !/\r?\n/.test(text)) return null;
  return clipboardTextToMatrix(text);
}

function htmlTableToMatrix(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) =>
        normalizeSpreadsheetHtmlCell(cell),
      ),
    )
    .filter((row) => row.length > 0);
  return rows.length > 0 ? rows : null;
}

function normalizeSpreadsheetHtmlCell(cell: Element) {
  return (cell.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function ensureXlsxRows(
  sheet: XlsxSheet,
  requiredRows: number,
  requiredColumns: number,
): XlsxRow[] {
  return Array.from({ length: Math.max(sheet.rows.length, requiredRows) }, (_, rowIndex) => {
    const row = sheet.rows[rowIndex] ?? {
      index: String(rowIndex + 1),
      cells: [] satisfies XlsxCell[],
    };
    return {
      ...row,
      index: row.index || String(rowIndex + 1),
      cells: normalizeXlsxCells(
        row.cells,
        requiredColumns,
        row.index || String(rowIndex + 1),
      ),
    };
  });
}

function ensureDelimitedRows(
  rows: string[][],
  requiredRows: number,
  requiredColumns: number,
) {
  return Array.from({ length: Math.max(rows.length, requiredRows) }, (_, rowIndex) =>
    normalizeRow(rows[rowIndex] ?? [], requiredColumns),
  );
}

function ensureDelimitedDisplayRows(rows: string[][], rowCount: number) {
  return Array.from({ length: Math.max(rows.length, rowCount) }, (_, rowIndex) =>
    rows[rowIndex] ?? [],
  );
}

function ensureXlsxDisplayRows(sheet: XlsxSheet, rowCount: number): XlsxRow[] {
  return Array.from({ length: Math.max(sheet.rows.length, rowCount) }, (_, rowIndex) => {
    const row = sheet.rows[rowIndex];
    if (row) return row;
    return {
      index: String(rowIndex + 1),
      cells: [] satisfies XlsxCell[],
    };
  });
}

function xlsxDisplayRowCount(sheet: XlsxSheet) {
  const mergedRows = (sheet.mergedRanges ?? [])
    .map((range) => xlsxRangeFromRef(range.ref)?.bottom ?? 0)
    .map((index) => index + 1);
  const conditionalRows = (sheet.conditionalFormattings ?? [])
    .flatMap((formatting) => xlsxSqrefRanges(formatting.sqref))
    .map((range) => range.bottom + 1);
  const validationRows = (sheet.dataValidations ?? [])
    .flatMap((validation) => xlsxSqrefRanges(validation.sqref))
    .map((range) => range.bottom + 1);
  const hyperlinkRows = (sheet.hyperlinks ?? [])
    .flatMap((hyperlink) => xlsxSqrefRanges(hyperlink.ref))
    .map((range) => range.bottom + 1);
  const commentRows = (sheet.comments ?? [])
    .flatMap((comment) => xlsxSqrefRanges(comment.ref))
    .map((range) => range.bottom + 1);
  return Math.max(
    MIN_XLSX_VISIBLE_ROWS,
    sheet.rows.length,
    ...mergedRows,
    ...conditionalRows,
    ...validationRows,
    ...hyperlinkRows,
    ...commentRows,
  );
}

function xlsxColumnCount(sheet: XlsxSheet) {
  const rowColumns = sheet.rows.map((row) => row.cells.length);
  const metadataColumns = (sheet.columns ?? []).map((column) => column.index + 1);
  const mergedColumns = (sheet.mergedRanges ?? [])
    .map((range) => xlsxRangeFromRef(range.ref)?.right ?? 0)
    .map((index) => index + 1);
  const conditionalColumns = (sheet.conditionalFormattings ?? [])
    .flatMap((formatting) => xlsxSqrefRanges(formatting.sqref))
    .map((range) => range.right + 1);
  const hyperlinkColumns = (sheet.hyperlinks ?? [])
    .flatMap((hyperlink) => xlsxSqrefRanges(hyperlink.ref))
    .map((range) => range.right + 1);
  const commentColumns = (sheet.comments ?? [])
    .flatMap((comment) => xlsxSqrefRanges(comment.ref))
    .map((range) => range.right + 1);
  return Math.max(
    MIN_XLSX_VISIBLE_COLUMNS,
    ...rowColumns,
    ...metadataColumns,
    ...mergedColumns,
    ...conditionalColumns,
    ...hyperlinkColumns,
    ...commentColumns,
  );
}

function visibleXlsxColumns(sheet: XlsxSheet | undefined, columnCount: number) {
  return indexRange(0, columnCount).filter(
    (columnIndex) => !xlsxColumn(sheet, columnIndex)?.hidden,
  );
}

function xlsxColumn(sheet: XlsxSheet | undefined, columnIndex: number) {
  return sheet?.columns?.find((column) => column.index === columnIndex);
}

function xlsxColumnWidthPx(sheet: XlsxSheet | undefined, columnIndex: number) {
  const width = xlsxColumn(sheet, columnIndex)?.width ?? DEFAULT_XLSX_COLUMN_WIDTH;
  return Math.max(48, Math.round(width * 7 + 12));
}

function xlsxRowHeightPx(row: XlsxRow) {
  return Math.max(24, Math.round((row.height ?? DEFAULT_XLSX_ROW_HEIGHT) * 4 / 3));
}

function sumXlsxColumnWidths(sheet: XlsxSheet | undefined, columns: number[]) {
  return columns.reduce(
    (total, columnIndex) => total + xlsxColumnWidthPx(sheet, columnIndex),
    0,
  );
}

function upsertXlsxColumn(
  columns: XlsxColumn[] | undefined,
  columnIndex: number,
  patch: Partial<XlsxColumn>,
): XlsxColumn[] {
  const existing = columns ?? [];
  const next = existing.some((column) => column.index === columnIndex)
    ? existing.map((column) =>
        column.index === columnIndex ? { ...column, ...patch } : column,
      )
    : [...existing, { index: columnIndex, ...patch }];
  return next
    .filter((column) =>
      column.hidden || column.width !== undefined,
    )
    .sort((left, right) => left.index - right.index);
}

function shiftXlsxColumnsForInsert(
  columns: XlsxColumn[] | undefined,
  insertAt: number,
) {
  return (columns ?? []).map((column) => ({
    ...column,
    index: column.index >= insertAt ? column.index + 1 : column.index,
  }));
}

function shiftXlsxColumnsForDelete(
  columns: XlsxColumn[] | undefined,
  deleteAt: number,
) {
  return (columns ?? [])
    .filter((column) => column.index !== deleteAt)
    .map((column) => ({
      ...column,
      index: column.index > deleteAt ? column.index - 1 : column.index,
    }));
}

function insertXlsxCell(cells: XlsxCell[], insertAt: number, rowIndex: string) {
  const next = [...cells];
  next.splice(insertAt, 0, {
    ref: `${columnName(insertAt)}${rowIndex}`,
    value: "",
  });
  return next.map((cell, cellIndex) => ({
    ...cell,
    ref: `${columnName(cellIndex)}${rowIndex}`,
  }));
}

function reindexXlsxRows(rows: XlsxRow[], columnCount: number) {
  return rows.map((row, rowIndex) => {
    const nextRowIndex = String(rowIndex + 1);
    return {
      ...row,
      index: nextRowIndex,
      cells: normalizeXlsxCells(row.cells, columnCount, nextRowIndex).map(
        (cell, cellIndex) => ({
          ...cell,
          ref: `${columnName(cellIndex)}${nextRowIndex}`,
        }),
      ),
    };
  });
}

function optionalTrimmedString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function xlsxTableLabel(table: XlsxTable) {
  return table.displayName ?? table.name ?? table.id;
}

function xlsxTableDetail(table: XlsxTable) {
  const columnCount = table.columns?.length;
  return [
    table.ref,
    columnCount ? `${columnCount} columns` : undefined,
    table.totalsRowShown ? "totals" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function xlsxChartLabel(chart: XlsxChart) {
  return [chart.title, chart.type ? `${chart.type} chart` : "chart", chart.path]
    .filter(Boolean)
    .join(" · ");
}

function xlsxPivotLabel(pivot: XlsxPivot) {
  return [pivot.name, pivot.cacheId ? `cache ${pivot.cacheId}` : "pivot", pivot.id]
    .filter(Boolean)
    .join(" · ");
}

function xlsxAnchorLabel(anchor: XlsxChart["anchor"]) {
  const from = anchor?.from;
  if (from?.row === undefined || from.column === undefined) return undefined;
  const start = `${columnName(from.column)}${from.row + 1}`;
  const to = anchor?.to;
  if (to?.row === undefined || to.column === undefined) return start;
  return `${start}:${columnName(to.column)}${to.row + 1}`;
}

function nonOverlappingMergedRanges(
  ranges: XlsxMergedRange[],
  selection: NormalizedCellRange,
) {
  return ranges.filter((range) => {
    const parsed = xlsxRangeFromRef(range.ref);
    return parsed ? !rangesOverlap(parsed, selection) : false;
  });
}

function xlsxDataValidationForRange(
  validations: XlsxDataValidation[] | undefined,
  selection: NormalizedCellRange,
) {
  return validations?.find((validation) =>
    xlsxSqrefRanges(validation.sqref).some((range) => rangesOverlap(range, selection)),
  );
}

function xlsxCellHasDataValidation(
  validations: XlsxDataValidation[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    validations?.some((validation) =>
      xlsxSqrefRanges(validation.sqref).some(
        (range) =>
          row >= range.top &&
          row <= range.bottom &&
          column >= range.left &&
          column <= range.right,
      ),
    ),
  );
}

function xlsxHyperlinkForRange(
  hyperlinks: XlsxHyperlink[] | undefined,
  selection: NormalizedCellRange,
) {
  return hyperlinks?.find((hyperlink) =>
    xlsxSqrefRanges(hyperlink.ref).some((range) =>
      rangesOverlap(range, selection),
    ),
  );
}

function xlsxCellHasHyperlink(
  hyperlinks: XlsxHyperlink[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    hyperlinks?.some((hyperlink) =>
      xlsxSqrefRanges(hyperlink.ref).some(
        (range) =>
          row >= range.top &&
          row <= range.bottom &&
          column >= range.left &&
          column <= range.right,
      ),
    ),
  );
}

function nonOverlappingHyperlinks(
  hyperlinks: XlsxHyperlink[],
  selection: NormalizedCellRange,
) {
  return hyperlinks.filter((hyperlink) =>
    xlsxSqrefRanges(hyperlink.ref).every((range) => !rangesOverlap(range, selection)),
  );
}

function xlsxCommentForRange(
  comments: XlsxComment[] | undefined,
  selection: NormalizedCellRange,
) {
  return comments?.find((comment) =>
    xlsxSqrefRanges(comment.ref).some((range) =>
      rangesOverlap(range, selection),
    ),
  );
}

function xlsxCellHasComment(
  comments: XlsxComment[] | undefined,
  row: number,
  column: number,
) {
  return Boolean(
    comments?.some((comment) =>
      xlsxSqrefRanges(comment.ref).some(
        (range) =>
          row >= range.top &&
          row <= range.bottom &&
          column >= range.left &&
          column <= range.right,
      ),
    ),
  );
}

function nonOverlappingComments(
  comments: XlsxComment[],
  selection: NormalizedCellRange,
) {
  return comments.filter((comment) =>
    xlsxSqrefRanges(comment.ref).every((range) => !rangesOverlap(range, selection)),
  );
}

function nonOverlappingDataValidations(
  validations: XlsxDataValidation[],
  selection: NormalizedCellRange,
) {
  return validations.filter((validation) =>
    xlsxSqrefRanges(validation.sqref).every((range) => !rangesOverlap(range, selection)),
  );
}

function xlsxConditionalRuleForRange(
  formattings: XlsxConditionalFormatting[] | undefined,
  selection: NormalizedCellRange,
) {
  return formattings
    ?.find((formatting) =>
      xlsxSqrefRanges(formatting.sqref).some((range) =>
        rangesOverlap(range, selection),
      ),
    )
    ?.rules.find((rule) => Boolean(rule.type || rule.sourceXml));
}

function nonOverlappingConditionalFormattings(
  formattings: XlsxConditionalFormatting[],
  selection: NormalizedCellRange,
) {
  return formattings.filter((formatting) =>
    xlsxSqrefRanges(formatting.sqref).every(
      (range) => !rangesOverlap(range, selection),
    ),
  );
}

function shiftXlsxConditionalFormattingsForRowInsert(
  formattings: XlsxConditionalFormatting[] | undefined,
  insertAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) {
      return { ...range, bottom: range.bottom + 1 };
    }
    return range;
  });
}

function shiftXlsxConditionalFormattingsForColumnInsert(
  formattings: XlsxConditionalFormatting[] | undefined,
  insertAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) {
      return { ...range, right: range.right + 1 };
    }
    return range;
  });
}

function shiftXlsxConditionalFormattingsForRowDelete(
  formattings: XlsxConditionalFormatting[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return { ...range, bottom: range.bottom - 1 };
  });
}

function shiftXlsxConditionalFormattingsForColumnDelete(
  formattings: XlsxConditionalFormatting[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxConditionalFormattings(formattings, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return { ...range, right: range.right - 1 };
  });
}

function shiftXlsxConditionalFormattings(
  formattings: XlsxConditionalFormatting[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (formattings ?? [])
    .map((formatting) => {
      const ranges = xlsxSqrefRanges(formatting.sqref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...formatting, sqref: ranges.map(rangeToA1).join(" ") };
    })
    .filter(
      (formatting): formatting is XlsxConditionalFormatting =>
        formatting !== null,
    );
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxDataValidationsForRowInsert(
  validations: XlsxDataValidation[] | undefined,
  insertAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) {
      return { ...range, bottom: range.bottom + 1 };
    }
    return range;
  });
}

function shiftXlsxDataValidationsForColumnInsert(
  validations: XlsxDataValidation[] | undefined,
  insertAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) {
      return { ...range, right: range.right + 1 };
    }
    return range;
  });
}

function shiftXlsxDataValidationsForRowDelete(
  validations: XlsxDataValidation[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return {
      ...range,
      bottom: range.bottom - 1,
    };
  });
}

function shiftXlsxDataValidationsForColumnDelete(
  validations: XlsxDataValidation[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxDataValidations(validations, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return {
      ...range,
      right: range.right - 1,
    };
  });
}

function shiftXlsxDataValidations(
  validations: XlsxDataValidation[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (validations ?? [])
    .map((validation) => {
      const ranges = xlsxSqrefRanges(validation.sqref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...validation, sqref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((validation): validation is XlsxDataValidation => validation !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxHyperlinksForRowInsert(
  hyperlinks: XlsxHyperlink[] | undefined,
  insertAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) {
      return { ...range, bottom: range.bottom + 1 };
    }
    return range;
  });
}

function shiftXlsxHyperlinksForColumnInsert(
  hyperlinks: XlsxHyperlink[] | undefined,
  insertAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) {
      return { ...range, right: range.right + 1 };
    }
    return range;
  });
}

function shiftXlsxHyperlinksForRowDelete(
  hyperlinks: XlsxHyperlink[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return { ...range, bottom: range.bottom - 1 };
  });
}

function shiftXlsxHyperlinksForColumnDelete(
  hyperlinks: XlsxHyperlink[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxHyperlinks(hyperlinks, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return { ...range, right: range.right - 1 };
  });
}

function shiftXlsxHyperlinks(
  hyperlinks: XlsxHyperlink[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (hyperlinks ?? [])
    .map((hyperlink) => {
      const ranges = xlsxSqrefRanges(hyperlink.ref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...hyperlink, ref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((hyperlink): hyperlink is XlsxHyperlink => hyperlink !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxCommentsForRowInsert(
  comments: XlsxComment[] | undefined,
  insertAt: number,
) {
  return shiftXlsxComments(comments, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) {
      return { ...range, bottom: range.bottom + 1 };
    }
    return range;
  });
}

function shiftXlsxCommentsForColumnInsert(
  comments: XlsxComment[] | undefined,
  insertAt: number,
) {
  return shiftXlsxComments(comments, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) {
      return { ...range, right: range.right + 1 };
    }
    return range;
  });
}

function shiftXlsxCommentsForRowDelete(
  comments: XlsxComment[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxComments(comments, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return { ...range, bottom: range.bottom - 1 };
  });
}

function shiftXlsxCommentsForColumnDelete(
  comments: XlsxComment[] | undefined,
  deleteAt: number,
) {
  return shiftXlsxComments(comments, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return { ...range, right: range.right - 1 };
  });
}

function shiftXlsxComments(
  comments: XlsxComment[] | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  const shifted = (comments ?? [])
    .map((comment) => {
      const ranges = xlsxSqrefRanges(comment.ref)
        .map(mapRange)
        .filter((range): range is NormalizedCellRange => range !== null);
      if (ranges.length === 0) return null;
      return { ...comment, ref: ranges.map(rangeToA1).join(" ") };
    })
    .filter((comment): comment is XlsxComment => comment !== null);
  return shifted.length > 0 ? shifted : undefined;
}

function shiftXlsxRangeForRowInsert(reference: string | undefined, insertAt: number) {
  return shiftXlsxRange(reference, (range) => {
    if (range.top >= insertAt) {
      return { ...range, top: range.top + 1, bottom: range.bottom + 1 };
    }
    if (range.bottom >= insertAt) {
      return { ...range, bottom: range.bottom + 1 };
    }
    return range;
  });
}

function shiftXlsxRangeForColumnInsert(reference: string | undefined, insertAt: number) {
  return shiftXlsxRange(reference, (range) => {
    if (range.left >= insertAt) {
      return { ...range, left: range.left + 1, right: range.right + 1 };
    }
    if (range.right >= insertAt) {
      return { ...range, right: range.right + 1 };
    }
    return range;
  });
}

function shiftXlsxRangeForRowDelete(reference: string | undefined, deleteAt: number) {
  return shiftXlsxRange(reference, (range) => {
    if (range.bottom < deleteAt) return range;
    if (range.top > deleteAt) {
      return { ...range, top: range.top - 1, bottom: range.bottom - 1 };
    }
    if (range.top === range.bottom) return null;
    return { ...range, bottom: range.bottom - 1 };
  });
}

function shiftXlsxRangeForColumnDelete(reference: string | undefined, deleteAt: number) {
  return shiftXlsxRange(reference, (range) => {
    if (range.right < deleteAt) return range;
    if (range.left > deleteAt) {
      return { ...range, left: range.left - 1, right: range.right - 1 };
    }
    if (range.left === range.right) return null;
    return { ...range, right: range.right - 1 };
  });
}

function shiftXlsxRange(
  reference: string | undefined,
  mapRange: (range: NormalizedCellRange) => NormalizedCellRange | null,
) {
  if (!reference) return undefined;
  const shifted = xlsxRangeFromRef(reference);
  if (!shifted) return undefined;
  const next = mapRange(shifted);
  return next ? rangeToA1(next) : undefined;
}

function xlsxSqrefRanges(sqref: string) {
  return sqref
    .split(/\s+/)
    .map((reference) => xlsxRangeFromRef(reference))
    .filter((range): range is NormalizedCellRange => range !== null);
}

function rangesOverlap(left: NormalizedCellRange, right: NormalizedCellRange) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

function xlsxConditionalCellStyle(
  formattings: XlsxConditionalFormatting[] | undefined,
  sheet: XlsxSheet | undefined,
  row: number,
  column: number,
  cell: XlsxCell,
  columnCount: number,
): CSSProperties {
  if (!formattings || !sheet) return {};
  for (const formatting of formattings) {
    const ranges = xlsxSqrefRanges(formatting.sqref);
    const inRange = ranges.some(
      (range) =>
        row >= range.top &&
        row <= range.bottom &&
        column >= range.left &&
        column <= range.right,
    );
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
  if (rule.type === "errors") return /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CYCLE!)$/i.test(value);
  if (rule.type === "expression") {
    const formula = rule.formulas?.[0]?.trim();
    if (!formula) return false;
    return evaluateConditionalFormula(sheet, columnCount, formula, row, column);
  }
  return false;
}

function compareConditionalCellValue(
  value: string,
  operator: XlsxConditionalOperator | undefined,
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

function filteredXlsxRows(
  rows: XlsxRow[],
  columnCount: number,
  filterText: string,
) {
  const query = filterText.trim().toLowerCase();
  return rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row, rowIndex }) => {
      if (row.hidden) return false;
      if (!query) return true;
      return normalizeXlsxCells(
        row.cells,
        columnCount,
        row.index || String(rowIndex + 1),
      ).some((cell) => displayXlsxCellValue(cell).toLowerCase().includes(query));
    });
}

function sortXlsxRows(
  rows: XlsxRow[],
  columnCount: number,
  columnIndex: number,
  direction: "asc" | "desc",
) {
  return rows
    .map((row, rowIndex) =>
      normalizeXlsxRowForPosition(row, rowIndex, columnCount),
    )
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      const result = compareSpreadsheetValues(
        displayXlsxCellValue(left.row.cells[columnIndex]),
        displayXlsxCellValue(right.row.cells[columnIndex]),
      );
      if (result !== 0) return direction === "asc" ? result : -result;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ row }, rowIndex) =>
      normalizeXlsxRowForPosition(row, rowIndex, columnCount),
    );
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

function filteredDelimitedRows(
  rows: string[][],
  columnCount: number,
  filterText: string,
) {
  const query = filterText.trim().toLowerCase();
  return rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      if (!query) return true;
      return normalizeRow(row, columnCount).some((cell) =>
        cell.toLowerCase().includes(query),
      );
    });
}

function sortDelimitedRows(
  rows: string[][],
  columnCount: number,
  columnIndex: number,
  direction: "asc" | "desc",
) {
  return rows
    .map((row, originalIndex) => ({
      row: normalizeRow(row, columnCount),
      originalIndex,
    }))
    .sort((left, right) => {
      const result = compareSpreadsheetValues(
        left.row[columnIndex] ?? "",
        right.row[columnIndex] ?? "",
      );
      if (result !== 0) return direction === "asc" ? result : -result;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ row }) => row);
}

function compareSpreadsheetValues(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function spreadsheetDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function spreadsheetTimeStamp() {
  return new Date().toTimeString().slice(0, 5);
}

function recalculateXlsxModel(model: XlsxModel): XlsxModel {
  return {
    definedNames: model.definedNames?.map((definedName) => ({ ...definedName })),
    sheets: model.sheets.map((sheet) => {
      const columnCount = xlsxColumnCount(sheet);
      return recalculateXlsxSheet(sheet, columnCount);
    }),
  };
}

function recalculateXlsxSheet(sheet: XlsxSheet, columnCount: number): XlsxSheet {
  const normalizedRows = sheet.rows.map((row, rowIndex) =>
    normalizeXlsxRowForPosition(row, rowIndex, columnCount),
  );
  const cellsByRef = new Map<string, XlsxCell>();
  for (const row of normalizedRows) {
    for (const cell of row.cells) {
      cellsByRef.set(normalizeFormulaRef(cell.ref), cell);
    }
  }

  const cache = new Map<string, string>();
  function evaluateCell(reference: string, visiting = new Set<string>()): string {
    const normalized = normalizeFormulaRef(reference);
    if (cache.has(normalized)) return cache.get(normalized) ?? "";
    const cell = cellsByRef.get(normalized);
    if (!cell) return "";
    if (!cell.formula) return cell.value;
    if (visiting.has(normalized)) return "#CYCLE!";
    const nextVisiting = new Set(visiting);
    nextVisiting.add(normalized);
    const value = evaluateFormulaCachedValue(cell.formula, cell.value, (ref) =>
      evaluateCell(ref, nextVisiting),
    );
    cache.set(normalized, value);
    return value;
  }

  return {
    ...sheet,
    rows: normalizedRows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) =>
        cell.formula
          ? { ...cell, value: evaluateCell(cell.ref) }
          : cell,
      ),
    })),
  };
}

function evaluateFormulaCachedValue(
  formula: string,
  fallback: string,
  valueForRef: (reference: string) => string,
) {
  try {
    const result = evaluateSpreadsheetFormula(formula, valueForRef);
    if (typeof result === "number" && !Number.isFinite(result)) return fallback;
    return formatSpreadsheetFormulaResult(result);
  } catch {
    return fallback;
  }
}

function normalizeFormulaRef(reference: string) {
  return reference
    .slice(reference.lastIndexOf("!") + 1)
    .replace(/\$/g, "")
    .toUpperCase();
}

function displayXlsxCellValue(cell?: XlsxCell, showFormulas = false) {
  if (!cell) return "";
  return cell.formula && showFormulas ? `=${cell.formula}` : cell.value;
}

function formulaBarXlsxCellValue(cell?: XlsxCell) {
  if (!cell) return "";
  return cell.formula ? `=${cell.formula}` : cell.value;
}

function xlsxCellFromInput(input: string) {
  if (input.startsWith("=")) {
    return { value: "", formula: input.slice(1) };
  }
  return { value: input, formula: undefined };
}

function xlsxCellStyleFromCell(cell: XlsxCell): XlsxCellStylePatch {
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

function normalizeXlsxStylePatch(patch: XlsxCellStylePatch): XlsxCellStylePatch {
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

function stripXlsxCellStyle(cell: XlsxCell): XlsxCell {
  return {
    ref: cell.ref,
    value: cell.value,
    formula: cell.formula,
  };
}

function xlsxCellInputStyle(cell: XlsxCell): CSSProperties {
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

function xlsxHyperlinkCellStyle(
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

function xlsxFillInputFromCell(
  cell: XlsxCell | undefined,
  rowOffset: number,
  columnOffset: number,
) {
  if (!cell) return "";
  if (cell.formula) {
    return `=${adjustSpreadsheetFormulaReferences(cell.formula, rowOffset, columnOffset)}`;
  }
  return cell.value;
}

function nextXlsxSheetPath(model: XlsxModel) {
  const used = new Set(model.sheets.map((sheet) => sheet.id));
  const numbers = model.sheets
    .map((sheet) => /xl\/worksheets\/sheet(\d+)\.xml$/i.exec(sheet.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value));
  let number = Math.max(0, ...numbers) + 1;
  while (used.has(`xl/worksheets/sheet${number}.xml`)) number += 1;
  return `xl/worksheets/sheet${number}.xml`;
}

function normalizeColorInputValue(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value ?? "#84cc16" : "#84cc16";
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 1000 || !Number.isInteger(value)) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
  }
  return String(value);
}

function spreadsheetFormulaSuggestions(value: string) {
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

function applySpreadsheetFormulaSuggestion(value: string, functionName: string) {
  const base = value.startsWith("=") ? value : "=";
  const prefix = spreadsheetFormulaFunctionPrefix(base) ?? "";
  return `${base.slice(0, base.length - prefix.length)}${functionName}(`;
}
