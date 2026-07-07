import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import { xlsxConditionalCellStyle } from "../spreadsheetConditionalFormatting";
import {
  clipboardDataToMatrix,
  rangeToClipboardText,
} from "../spreadsheetData";
import {
  normalizeColorInputValue,
  normalizeXlsxStylePatch,
  spreadsheetCellClass,
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
  stripXlsxCellStyle,
  summarizeSelection,
  xlsxCellInputStyle,
  xlsxCellStyleFromCell,
  xlsxHyperlinkCellStyle,
  xlsxMergedCellClass,
} from "../spreadsheetPresentation";
import type { XlsxCellStylePatch } from "../spreadsheetPresentation";
import { SpreadsheetFormulaDependencyPanel } from "../spreadsheetFormulaPanel";
import { SpreadsheetToolbar } from "../spreadsheetToolbar";
import {
  SpreadsheetColumnSpacer,
  SpreadsheetObjectStrip,
  SpreadsheetSpacerRow,
  SpreadsheetStatusBar,
} from "../spreadsheetPanels";
import {
  DEFAULT_XLSX_COLUMN_WIDTH,
  DEFAULT_XLSX_ROW_HEIGHT,
  MIN_XLSX_VISIBLE_COLUMNS,
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  clampCellRange,
  clampNumber,
  emptyViewport,
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
  xlsxRangeFromRef,
} from "../spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "../spreadsheetGeometry";
import {
  nonOverlappingComments,
  nonOverlappingConditionalFormattings,
  nonOverlappingDataValidations,
  nonOverlappingHyperlinks,
  nonOverlappingMergedRanges,
  shiftXlsxCommentsForColumnDelete,
  shiftXlsxCommentsForColumnInsert,
  shiftXlsxCommentsForRowDelete,
  shiftXlsxCommentsForRowInsert,
  shiftXlsxConditionalFormattingsForColumnDelete,
  shiftXlsxConditionalFormattingsForColumnInsert,
  shiftXlsxConditionalFormattingsForRowDelete,
  shiftXlsxConditionalFormattingsForRowInsert,
  shiftXlsxDataValidationsForColumnDelete,
  shiftXlsxDataValidationsForColumnInsert,
  shiftXlsxDataValidationsForRowDelete,
  shiftXlsxDataValidationsForRowInsert,
  shiftXlsxHyperlinksForColumnDelete,
  shiftXlsxHyperlinksForColumnInsert,
  shiftXlsxHyperlinksForRowDelete,
  shiftXlsxHyperlinksForRowInsert,
  shiftXlsxRangeForColumnDelete,
  shiftXlsxRangeForColumnInsert,
  shiftXlsxRangeForRowDelete,
  shiftXlsxRangeForRowInsert,
  xlsxCellHasComment,
  xlsxCellHasDataValidation,
  xlsxCellHasHyperlink,
  xlsxCommentForRange,
  xlsxConditionalRuleForRange,
  xlsxDataValidationForRange,
  xlsxHyperlinkForRange,
} from "../spreadsheetXlsxMetadata";
import {
  displayXlsxCellValue,
  ensureXlsxDisplayRows,
  ensureXlsxRows,
  filteredXlsxRows,
  formulaBarXlsxCellValue,
  insertXlsxCell,
  nextXlsxSheetPath,
  recalculateXlsxModel,
  recalculateXlsxSheet,
  reindexXlsxRows,
  shiftXlsxColumnsForDelete,
  shiftXlsxColumnsForInsert,
  sortXlsxRows,
  sumXlsxColumnWidths,
  upsertXlsxColumn,
  valuesFromXlsxRange,
  visibleXlsxColumns,
  xlsxCellFromInput,
  xlsxColumn,
  xlsxColumnCount,
  xlsxColumnWidthPx,
  xlsxDisplayRowCount,
  xlsxFillInputFromCell,
  xlsxRowHeightPx,
} from "../spreadsheetXlsxModel";
import {
  columnName,
  normalizeXlsxCells,
} from "../models";
import type {
  XlsxCell,
  XlsxChart,
  XlsxConditionalRule,
  XlsxComment,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxModel,
  XlsxPivot,
  XlsxSheet,
  XlsxSheetProtection,
} from "../models";

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
  const [fillDrag, setFillDrag] = useState<{
    source: NormalizedCellRange;
    end: CellPosition;
  } | null>(null);
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
  const fillPreviewRange = fillDrag
    ? spreadsheetFillTargetRange(fillDrag.source, fillDrag.end)
    : null;
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
  const activeCellReference = activeCell
    ? `${columnName(activeCell.column)}${activeCell.row + 1}`
    : undefined;
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

  function applyFillDrag(drag: {
    source: NormalizedCellRange;
    end: CellPosition;
  }) {
    if (!sheet) return;
    const target = spreadsheetFillTargetRange(drag.source, drag.end);
    if (
      target.top === drag.source.top &&
      target.right === drag.source.right &&
      target.bottom === drag.source.bottom &&
      target.left === drag.source.left
    ) {
      return;
    }
    const sourceHeight = drag.source.bottom - drag.source.top + 1;
    const sourceWidth = drag.source.right - drag.source.left + 1;
    const sourceRows = ensureXlsxRows(
      sheet,
      drag.source.bottom + 1,
      Math.max(columnCount, drag.source.right + 1),
    );
    const matrix = rangeIndexes(target.top, target.bottom).map((rowIndex) =>
      rangeIndexes(target.left, target.right).map((columnIndex) => {
        const sourceRowIndex =
          drag.source.top + positiveModulo(rowIndex - drag.source.top, sourceHeight);
        const sourceColumnIndex =
          drag.source.left + positiveModulo(columnIndex - drag.source.left, sourceWidth);
        const sourceCell = normalizeXlsxCells(
          sourceRows[sourceRowIndex]?.cells ?? [],
          Math.max(columnCount, drag.source.right + 1),
          sourceRows[sourceRowIndex]?.index ?? String(sourceRowIndex + 1),
        )[sourceColumnIndex];
        return xlsxFillInputFromCell(
          sourceCell,
          rowIndex - sourceRowIndex,
          columnIndex - sourceColumnIndex,
        );
      }),
    );
    updateCellsFromMatrix(target.top, target.left, matrix);
    setActiveCell({ row: target.bottom, column: target.right });
    setSelectionAnchor({ row: target.top, column: target.left });
    setSelectionEnd({ row: target.bottom, column: target.right });
  }

  function startFillDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    source: NormalizedCellRange,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setFillDrag({
      source,
      end: { row: source.bottom, column: source.right },
    });
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

  const finishFillDrag = useEffectEvent(
    (drag: { source: NormalizedCellRange; end: CellPosition }) => {
      applyFillDrag(drag);
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

  useEffect(() => {
    if (!fillDrag) return;
    function handlePointerUp() {
      const drag = fillDrag;
      setFillDrag(null);
      if (drag) finishFillDrag(drag);
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [fillDrag]);

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
      <SpreadsheetFormulaDependencyPanel
        sheet={sheet}
        activeReference={activeCellReference}
        onSelectReference={selectReference}
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
                      fillPreviewRange &&
                        spreadsheetRangeContainsCell(fillPreviewRange, rowIndex, cellIndex) &&
                        "outline outline-1 outline-offset-[-1px] outline-[rgba(132,204,22,0.75)]",
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
                        if (fillDrag && event.buttons === 1) {
                          setFillDrag({
                            ...fillDrag,
                            end: { row: rowIndex, column: cellIndex },
                          });
                          return;
                        }
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
                    {selectionRange &&
                      selectionRange.bottom === rowIndex &&
                      selectionRange.right === cellIndex && (
                        <button
                          type="button"
                          onPointerDown={(event) => startFillDrag(event, selectionRange)}
                          className="absolute bottom-0 right-0 z-20 h-2.5 w-2.5 translate-x-1/2 translate-y-1/2 cursor-crosshair border border-white bg-[var(--accent)] shadow-sm"
                          title="Fill handle"
                          aria-label="Fill handle"
                        />
                      )}
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

function spreadsheetFillTargetRange(
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

function spreadsheetRangeContainsCell(
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

function positiveModulo(value: number, divisor: number) {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}
