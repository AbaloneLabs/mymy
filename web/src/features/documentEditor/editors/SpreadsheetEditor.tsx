import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { EditorCommandRequest } from "../commands";
import {
  remapXlsxDefinedNameSheetScopes,
  renameXlsxDefinedNameSheetReferences,
  shiftXlsxDefinedNamesForColumnDelete,
  shiftXlsxDefinedNamesForColumnInsert,
  shiftXlsxDefinedNamesForRowDelete,
  shiftXlsxDefinedNamesForRowInsert,
  xlsxDefinedNameTarget,
  xlsxDefinedNameValueForSheet,
} from "../spreadsheetDefinedNames";
import { SpreadsheetDefinedNamesPanel } from "../spreadsheetDefinedNamesPanel";
import { rangeToClipboardText } from "../spreadsheetData";
import { SpreadsheetGrid } from "../spreadsheetGrid";
import {
  normalizeXlsxStylePatch,
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
  stripXlsxCellStyle,
  summarizeSelection,
  xlsxCellStyleFromCell,
} from "../spreadsheetPresentation";
import type { XlsxCellStylePatch } from "../spreadsheetPresentation";
import { SpreadsheetFormulaDependencyPanel } from "../spreadsheetFormulaPanel";
import { SpreadsheetToolbar } from "../spreadsheetToolbar";
import {
  nextDefinedName,
  positiveModulo,
  shiftXlsxTables,
  spreadsheetFillTargetRange,
} from "../spreadsheetEditorUtils";
import {
  SpreadsheetObjectStrip,
  SpreadsheetStatusBar,
} from "../spreadsheetPanels";
import { SpreadsheetSheetTabs } from "../spreadsheetSheetTabs";
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
  rangeIndexes,
  rangeToA1,
  scrollCellIntoView,
  singleCellRange,
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
  xlsxCommentForRange,
  xlsxConditionalRuleForRange,
  xlsxDataValidationForRange,
  xlsxHyperlinkForRange,
} from "../spreadsheetXlsxMetadata";
import {
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
  XlsxDefinedName,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxModel,
  XlsxPivot,
  XlsxSheet,
  XlsxSheetProtection,
  XlsxTable,
  XlsxTableColumn,
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
  const [extraSelectionRanges, setExtraSelectionRanges] = useState<
    NormalizedCellRange[]
  >([]);
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
  const activeSingleCellRange = activeCell
    ? {
        top: activeCell.row,
        right: activeCell.column,
        bottom: activeCell.row,
        left: activeCell.column,
      }
    : null;
  const selectedRanges = [
    ...extraSelectionRanges,
    ...(selectionRange ? [selectionRange] : activeSingleCellRange ? [activeSingleCellRange] : []),
  ];
  const activeDefinedNameValue =
    sheet && selectionRange
      ? xlsxDefinedNameValueForSheet(sheet.name, selectionRange)
      : undefined;
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
    displayGridSheet && selectedRanges.length > 0
      ? selectedRanges.flatMap((range) =>
          valuesFromXlsxRange(displayGridSheet, columnCount, range, showFormulas),
        )
      : activeCellValue
        ? [[activeCellValue]]
        : [];
  const selectionSummary = summarizeSelection(selectedValues);

  function commitXlsxModel(next: XlsxModel) {
    onChange(
      recalculateXlsxModel({
        ...next,
        definedNames:
          next.definedNames ?? model.definedNames?.map((definedName) => ({ ...definedName })),
      }),
    );
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

  function updateSheetTables(updater: (tables: XlsxTable[]) => XlsxTable[]) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, tables: updater(item.tables ?? []) }
          : item,
      ),
    });
  }

  function updateTable(tableId: string, patch: Partial<XlsxTable>) {
    updateSheetTables((tables) =>
      tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table)),
    );
  }

  function updateTableColumn(
    tableId: string,
    columnIndex: number,
    patch: Partial<XlsxTableColumn>,
  ) {
    updateSheetTables((tables) =>
      tables.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: (table.columns ?? []).map((column, currentIndex) =>
                currentIndex === columnIndex ? { ...column, ...patch } : column,
              ),
            }
          : table,
      ),
    );
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

  function selectCell(position: CellPosition, extend = false, additive = false) {
    setActiveCell(position);
    if (additive) {
      if (selectionRange) {
        setExtraSelectionRanges((current) =>
          addSpreadsheetSelectionRange(current, selectionRange),
        );
      }
      setSelectionAnchor(position);
      setSelectionEnd(position);
      return;
    }
    if (extend && selectionAnchor) {
      setSelectionEnd(position);
    } else {
      setExtraSelectionRanges([]);
      setSelectionAnchor(position);
      setSelectionEnd(position);
    }
  }

  function selectAllCells() {
    setExtraSelectionRanges([]);
    setActiveCell({ row: 0, column: 0 });
    setSelectionAnchor({ row: 0, column: 0 });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, 0, 0);
  }

  function selectColumn(column: number) {
    setExtraSelectionRanges([]);
    setActiveCell({ row: 0, column });
    setSelectionAnchor({ row: 0, column });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column,
    });
    scrollCellIntoView(gridRef.current, 0, column);
  }

  function selectRow(row: number) {
    setExtraSelectionRanges([]);
    setActiveCell({ row, column: 0 });
    setSelectionAnchor({ row, column: 0 });
    setSelectionEnd({
      row,
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, row, 0);
  }

  async function copySelection() {
    if (!sheet || !displayGridSheet || selectedRanges.length === 0) return;
    const text = selectedRanges
      .map((range) =>
        rangeToClipboardText(
          valuesFromXlsxRange(displayGridSheet, columnCount, range, showFormulas),
        ),
      )
      .join("\n\n");
    await navigator.clipboard?.writeText(text);
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
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForRowInsert(reference, insertAt),
              ),
              autoFilter: shiftXlsxRangeForRowInsert(item.autoFilter, insertAt),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForRowInsert(
        model.definedNames,
        model.sheets,
        sheet.id,
        insertAt,
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
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForColumnInsert(reference, insertAt),
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
      definedNames: shiftXlsxDefinedNamesForColumnInsert(
        model.definedNames,
        model.sheets,
        sheet.id,
        insertAt,
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
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: remapXlsxDefinedNameSheetScopes(
        model.definedNames,
        model.sheets,
        nextSheets,
      ),
    });
    setPreferredSheetId(nextSheets[0]?.id ?? null);
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
  }

  function renameSheet(name: string) {
    if (!sheet) return;
    const nextSheets = model.sheets.map((item) =>
      item.id === sheet.id ? { ...item, name } : item,
    );
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: renameXlsxDefinedNameSheetReferences(
        model.definedNames,
        sheet.name,
        name,
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
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: remapXlsxDefinedNameSheetScopes(
        model.definedNames,
        model.sheets,
        nextSheets,
      ),
    });
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
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForRowDelete(reference, activeCell.row),
              ),
              autoFilter: shiftXlsxRangeForRowDelete(
                item.autoFilter,
                activeCell.row,
              ),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForRowDelete(
        model.definedNames,
        model.sheets,
        sheet.id,
        activeCell.row,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setExtraSelectionRanges([]);
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
              tables: shiftXlsxTables(item.tables, (reference) =>
                shiftXlsxRangeForColumnDelete(reference, activeCell.column),
              ),
              autoFilter: shiftXlsxRangeForColumnDelete(
                item.autoFilter,
                activeCell.column,
              ),
            }
          : item,
      ),
      definedNames: shiftXlsxDefinedNamesForColumnDelete(
        model.definedNames,
        model.sheets,
        sheet.id,
        activeCell.column,
      ),
    });
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setExtraSelectionRanges([]);
  }

  function clearActiveCell() {
    if (!activeCell) return;
    updateCell(activeCell.row, activeCell.column, "");
  }

  function updateSelectedCells(
    updater: (cell: XlsxCell, rowIndex: number, cellIndex: number) => XlsxCell,
  ) {
    if (!sheet) return;
    if (selectedRanges.length === 0) return;
    const bottom = Math.max(...selectedRanges.map((range) => range.bottom));
    const right = Math.max(...selectedRanges.map((range) => range.right));
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              rows: ensureXlsxRows(
                item,
                bottom + 1,
                Math.max(columnCount, right + 1),
              ).map((row, rowIndex) =>
                selectedRanges.some(
                  (range) => rowIndex >= range.top && rowIndex <= range.bottom,
                )
                  ? {
                      ...row,
                      cells: normalizeXlsxCells(
                        row.cells,
                        columnCount,
                        row.index || String(rowIndex + 1),
                      ).map((cell, cellIndex) =>
                        selectedRanges.some(
                          (range) =>
                            rowIndex >= range.top &&
                            rowIndex <= range.bottom &&
                            cellIndex >= range.left &&
                            cellIndex <= range.right,
                        )
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

  function addDefinedNameFromSelection() {
    if (!sheet || !selectionRange || !activeDefinedNameValue) return;
    const localSheetId = model.sheets.findIndex((item) => item.id === sheet.id);
    const next: XlsxDefinedName = {
      name: nextDefinedName(model.definedNames ?? [], localSheetId),
      value: activeDefinedNameValue,
      localSheetId: localSheetId >= 0 ? localSheetId : undefined,
    };
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: [...(model.definedNames ?? []), next],
    });
  }

  function updateDefinedName(index: number, next: XlsxDefinedName) {
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: (model.definedNames ?? []).map((definedName, currentIndex) =>
        currentIndex === index ? next : definedName,
      ),
    });
  }

  function deleteDefinedName(index: number) {
    commitXlsxModel({
      sheets: model.sheets,
      definedNames: (model.definedNames ?? []).filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    });
  }

  function selectDefinedName(definedName: XlsxDefinedName) {
    const target = xlsxDefinedNameTarget(definedName.value);
    if (!target) return;
    const targetSheetIndex =
      target.sheetName !== undefined
        ? model.sheets.findIndex((item) => item.name === target.sheetName)
        : definedName.localSheetId;
    const targetSheet =
      targetSheetIndex !== undefined
        ? model.sheets[targetSheetIndex]
        : sheet;
    if (!targetSheet) return;
    const targetColumnCount = xlsxColumnCount(targetSheet);
    const targetRowCount = xlsxDisplayRowCount(targetSheet);
    const clamped = clampCellRange(target.range, targetRowCount, targetColumnCount);
    setPreferredSheetId(targetSheet.id);
    setActiveCell({ row: clamped.top, column: clamped.left });
    setSelectionAnchor({ row: clamped.top, column: clamped.left });
    setSelectionEnd({ row: clamped.bottom, column: clamped.right });
    requestAnimationFrame(() => {
      scrollCellIntoView(gridRef.current, clamped.top, clamped.left);
    });
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
            ? extraSelectionRanges.length > 0
              ? `${rangeToA1(selectionRange)} +${extraSelectionRanges.length}`
              : rangeToA1(selectionRange)
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
        canCopy={selectedRanges.length > 0}
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
        canFormat={selectedRanges.length > 0}
        canSort={Boolean(activeCell)}
      />
      <SpreadsheetSheetTabs
        sheets={model.sheets}
        activeSheet={sheet}
        onSelectSheet={(sheetId) => {
          setPreferredSheetId(sheetId);
          setActiveCell(null);
          setSelectionAnchor(null);
          setSelectionEnd(null);
          setExtraSelectionRanges([]);
        }}
        onAddSheet={addSheet}
        onDuplicateSheet={duplicateSheet}
        onDeleteSheet={deleteSheet}
        onMoveSheet={moveSheet}
        onRenameSheet={renameSheet}
        onSheetStateChange={updateSheetState}
        onSheetTabColorChange={updateSheetTabColor}
      />
      <SpreadsheetObjectStrip
        sheet={sheet}
        onTableChange={updateTable}
        onTableColumnChange={updateTableColumn}
        onChartTitleChange={updateChartTitle}
        onChartSeriesNameChange={updateChartSeriesName}
        onChartPointChange={updateChartSeriesPoint}
        onPivotNameChange={updatePivotName}
      />
      <SpreadsheetDefinedNamesPanel
        definedNames={model.definedNames ?? []}
        sheets={model.sheets}
        activeSelectionValue={activeDefinedNameValue}
        onAddFromSelection={addDefinedNameFromSelection}
        onChange={updateDefinedName}
        onDelete={deleteDefinedName}
        onSelect={selectDefinedName}
      />
      <SpreadsheetFormulaDependencyPanel
        sheet={sheet}
        activeReference={activeCellReference}
        onSelectReference={selectReference}
      />
      <SpreadsheetGrid
        gridRef={gridRef}
        sheet={sheet}
        displaySheet={displaySheet}
        displayRowLimit={displayRowLimit}
        columnCount={columnCount}
        visibleColumns={visibleColumns}
        visibleColumnIndexes={visibleColumnIndexes}
        visibleRows={visibleRows}
        rowWindow={rowWindow}
        columnWindow={columnWindow}
        leftColumnSpacerWidth={leftColumnSpacerWidth}
        rightColumnSpacerWidth={rightColumnSpacerWidth}
        activeCell={activeCell}
        selectionRange={selectionRange}
        extraSelectionRanges={extraSelectionRanges}
        fillDrag={fillDrag}
        fillPreviewRange={fillPreviewRange}
        showFormulas={showFormulas}
        onViewportChange={setViewport}
        onSelectAllCells={selectAllCells}
        onSelectColumn={selectColumn}
        onSelectRow={selectRow}
        onStartColumnResize={startColumnResize}
        onStartRowResize={startRowResize}
        onUpdateCell={updateCell}
        onSelectCell={selectCell}
        onCellKeyDown={handleCellKeyDown}
        onUpdateCellsFromMatrix={updateCellsFromMatrix}
        onSetFillDrag={setFillDrag}
        onStartFillDrag={startFillDrag}
      />
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}

function addSpreadsheetSelectionRange(
  ranges: NormalizedCellRange[],
  range: NormalizedCellRange,
) {
  if (ranges.some((item) => sameSpreadsheetRange(item, range))) return ranges;
  return [...ranges, range];
}

function sameSpreadsheetRange(left: NormalizedCellRange, right: NormalizedCellRange) {
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left
  );
}
