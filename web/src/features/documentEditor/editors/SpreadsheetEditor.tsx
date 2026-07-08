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
} from "../spreadsheetDefinedNames";
import { SpreadsheetDefinedNamesPanel } from "../spreadsheetDefinedNamesPanel";
import { rangeToClipboardText } from "../spreadsheetData";
import { buildXlsxChartSeriesFromSelection } from "../spreadsheetChartSeries";
import { SpreadsheetGrid } from "../spreadsheetGrid";
import {
  normalizeXlsxStylePatch,
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
  stripXlsxCellStyle,
} from "../spreadsheetPresentation";
import type { XlsxCellStylePatch } from "../spreadsheetPresentation";
import { SpreadsheetFormulaDependencyPanel } from "../spreadsheetFormulaPanel";
import { runSpreadsheetEditorCommand } from "../spreadsheetEditorCommands";
import { SpreadsheetToolbar } from "../spreadsheetToolbar";
import {
  buildXlsxTableFromRange,
  inferXlsxTableHeaders,
  nextDefinedName,
  resizeXlsxTableToRange,
  shiftXlsxTables,
  spreadsheetFillTargetRange,
  spreadsheetTableResizeTargetRange,
} from "../spreadsheetEditorUtils";
import { deriveSpreadsheetEditorState } from "../spreadsheetEditorState";
import type {
  SpreadsheetFillDrag,
  SpreadsheetTableResizeDrag,
} from "../spreadsheetEditorState";
import { buildXlsxAutofillMatrix } from "../spreadsheetSeriesFill";
import {
  nextDuplicateSheetName,
  nextGeneratedSheetName,
  renameXlsxSheetName,
} from "../spreadsheetSheetNames";
import { addSpreadsheetSelectionRange } from "../spreadsheetSelection";
import {
  SpreadsheetObjectStrip,
  SpreadsheetStatusBar,
} from "../spreadsheetPanels";
import { SpreadsheetSheetTabs } from "../spreadsheetSheetTabs";
import {
  clampCellRange,
  clampNumber,
  emptyViewport,
  rangeIndexes,
  rangeToA1,
  scrollCellIntoView,
  singleCellRange,
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
} from "../spreadsheetXlsxMetadata";
import {
  ensureXlsxRows,
  insertXlsxCell,
  nextXlsxSheetPath,
  recalculateXlsxModel,
  reindexXlsxRows,
  shiftXlsxColumnsForDelete,
  shiftXlsxColumnsForInsert,
  sortXlsxRows,
  upsertXlsxColumn,
  valuesFromXlsxRange,
  xlsxCellFromInput,
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
  XlsxConditionalRule,
  XlsxComment,
  XlsxDataValidation,
  XlsxDefinedName,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxModel,
  XlsxSheet,
  XlsxSheetProtection,
} from "../models";
import { createSpreadsheetObjectEditors } from "../spreadsheetObjectEditors";

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
  const [fillDrag, setFillDrag] = useState<SpreadsheetFillDrag | null>(null);
  const [tableResizeDrag, setTableResizeDrag] =
    useState<SpreadsheetTableResizeDrag | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showFormulas, setShowFormulas] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<SpreadsheetViewport>(emptyViewport);
  const {
    activeCellReference,
    activeCellStyle,
    activeCellValue,
    activeColumnWidth,
    activeComment,
    activeConditionalRule,
    activeDataValidation,
    activeDefinedNameValue,
    activeHyperlink,
    activeRowHeight,
    activeSingleCellRange,
    columnCount,
    columnWindow,
    displayGridSheet,
    displayRowLimit,
    displaySheet,
    fillPreviewRange,
    frozenColumns,
    frozenRows,
    leftColumnSpacerWidth,
    rightColumnSpacerWidth,
    rowWindow,
    selectedRanges,
    selectionRange,
    selectionSummary,
    sheet,
    tableResizePreviewRange,
    validationRange,
    visibleColumnIndexes,
    visibleColumns,
    visibleRows,
  } = deriveSpreadsheetEditorState({
    model,
    preferredSheetId,
    activeCell,
    selectionAnchor,
    selectionEnd,
    extraSelectionRanges,
    fillDrag,
    tableResizeDrag,
    filterText,
    showFormulas,
    viewport,
  });

  function commitXlsxModel(next: XlsxModel) {
    onChange(
      recalculateXlsxModel({
        ...next,
        definedNames:
          next.definedNames ?? model.definedNames?.map((definedName) => ({ ...definedName })),
      }),
    );
  }

  const objectEditors = createSpreadsheetObjectEditors({
    sheet,
    model,
    commitXlsxModel,
  });

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

  function rememberSelectionBeforeAdditive(additive: boolean) {
    const previousRange = selectionRange ?? activeSingleCellRange;
    if (!additive || !previousRange) return;
    setExtraSelectionRanges((current) =>
      addSpreadsheetSelectionRange(current, previousRange),
    );
  }

  function selectAllCells(additive = false) {
    rememberSelectionBeforeAdditive(additive);
    if (!additive) setExtraSelectionRanges([]);
    setActiveCell({ row: 0, column: 0 });
    setSelectionAnchor({ row: 0, column: 0 });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column: Math.max(0, columnCount - 1),
    });
    scrollCellIntoView(gridRef.current, 0, 0);
  }

  function selectColumn(column: number, extend = false, additive = false) {
    rememberSelectionBeforeAdditive(additive);
    if (!additive) setExtraSelectionRanges([]);
    const anchorColumn = extend && selectionAnchor ? selectionAnchor.column : column;
    setActiveCell({ row: 0, column });
    setSelectionAnchor({ row: 0, column: anchorColumn });
    setSelectionEnd({
      row: Math.max(0, displayRowLimit - 1),
      column,
    });
    scrollCellIntoView(gridRef.current, 0, column);
  }

  function selectRow(row: number, extend = false, additive = false) {
    rememberSelectionBeforeAdditive(additive);
    if (!additive) setExtraSelectionRanges([]);
    const anchorRow = extend && selectionAnchor ? selectionAnchor.row : row;
    setActiveCell({ row, column: 0 });
    setSelectionAnchor({ row: anchorRow, column: 0 });
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
    const matrix = buildXlsxAutofillMatrix({
      sheet,
      columnCount,
      source: drag.source,
      target,
    });
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
    const path = nextXlsxSheetPath(model);
    const next = {
      id: path,
      name: nextGeneratedSheetName(model),
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
      name: nextDuplicateSheetName(model, sheet.name),
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
    const nextName = renameXlsxSheetName(model, sheet.id, name);
    if (nextName === sheet.name) return;
    const nextSheets = model.sheets.map((item) =>
      item.id === sheet.id ? { ...item, name: nextName } : item,
    );
    commitXlsxModel({
      sheets: nextSheets,
      definedNames: renameXlsxDefinedNameSheetReferences(
        model.definedNames,
        sheet.name,
        nextName,
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

  function createTableFromSelection() {
    if (!sheet || !selectionRange) return;
    const ref = rangeToA1(selectionRange);
    const table = buildXlsxTableFromRange(sheet, selectionRange, ref);
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? { ...item, tables: [...(item.tables ?? []), table] }
          : item,
      ),
    });
  }

  function resizeTableToRange(tableId: string, range: NormalizedCellRange) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tables: (item.tables ?? []).map((table) =>
                table.id === tableId
                  ? resizeXlsxTableToRange(table, item, range)
                  : table,
              ),
            }
          : item,
      ),
    });
  }

  function resizeTableToSelection(tableId: string) {
    if (!selectionRange) return;
    resizeTableToRange(tableId, selectionRange);
  }

  function inferTableHeaders(tableId: string) {
    if (!sheet) return;
    commitXlsxModel({
      sheets: model.sheets.map((item) =>
        item.id === sheet.id
          ? {
              ...item,
              tables: (item.tables ?? []).map((table) => {
                const range = xlsxRangeFromRef(table.ref ?? "");
                return table.id === tableId && range
                  ? inferXlsxTableHeaders(table, item, range)
                  : table;
              }),
            }
          : item,
      ),
    });
  }

  function addChartSeriesFromSelection(chartId: string) {
    if (!sheet || !displayGridSheet || !selectionRange) return;
    const series = buildXlsxChartSeriesFromSelection({
      sheet,
      displaySheet: displayGridSheet,
      columnCount,
      selectionRange,
    });
    if (!series) return;
    objectEditors.addChartSeries(chartId, series);
  }

  function startTableResizeDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    tableId: string,
    source: NormalizedCellRange,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setTableResizeDrag({
      tableId,
      source,
      end: { row: source.bottom, column: source.right },
    });
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
      return runSpreadsheetEditorCommand(commandId, {
        fillDown,
        fillRight,
        sortRowsByActiveColumn,
        clearAutoFilter,
        setAutoFilterFromSelection,
        hasAutoFilter: Boolean(sheet?.autoFilter),
      });
    },
  );

  const finishFillDrag = useEffectEvent(
    (drag: { source: NormalizedCellRange; end: CellPosition }) => {
      applyFillDrag(drag);
    },
  );

  const finishTableResizeDrag = useEffectEvent(
    (drag: {
      tableId: string;
      source: NormalizedCellRange;
      end: CellPosition;
    }) => {
      resizeTableToRange(
        drag.tableId,
        spreadsheetTableResizeTargetRange(drag.source, drag.end),
      );
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

  useEffect(() => {
    if (!tableResizeDrag) return;
    function handlePointerUp() {
      const drag = tableResizeDrag;
      setTableResizeDrag(null);
      if (drag) finishTableResizeDrag(drag);
    }
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [tableResizeDrag]);

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
    const target = xlsxDefinedNameTarget(reference.trim());
    if (target) {
      const targetSheet =
        target.sheetName !== undefined
          ? model.sheets.find((item) => item.name === target.sheetName)
          : sheet;
      if (!targetSheet) return;
      const targetColumnCount = xlsxColumnCount(targetSheet);
      const targetRowCount = xlsxDisplayRowCount(targetSheet);
      const clamped = clampCellRange(
        target.range,
        targetRowCount,
        targetColumnCount,
      );
      setPreferredSheetId(targetSheet.id);
      setActiveCell({ row: clamped.top, column: clamped.left });
      setSelectionAnchor({ row: clamped.top, column: clamped.left });
      setSelectionEnd({ row: clamped.bottom, column: clamped.right });
      requestAnimationFrame(() => {
        scrollCellIntoView(gridRef.current, clamped.top, clamped.left);
      });
      return;
    }
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
        onCreateTable={createTableFromSelection}
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
        canCreateTable={Boolean(selectionRange)}
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
        selectionRange={selectionRange}
        onTableChange={objectEditors.updateTable}
        onTableColumnChange={objectEditors.updateTableColumn}
        onTableResizeToSelection={resizeTableToSelection}
        onTableInferHeaders={inferTableHeaders}
        onChartChange={objectEditors.updateChart}
        canAddChartSeriesFromSelection={Boolean(selectionRange)}
        onChartAddSeriesFromSelection={addChartSeriesFromSelection}
        onChartSeriesChange={objectEditors.updateChartSeries}
        onChartSeriesNameChange={objectEditors.updateChartSeriesName}
        onChartPointChange={objectEditors.updateChartSeriesPoint}
        onPivotNameChange={objectEditors.updatePivotName}
        onPivotFieldChange={objectEditors.updatePivotField}
        onPivotDataFieldChange={objectEditors.updatePivotDataField}
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
        recalculatedSheet={displaySheet}
        sheets={model.sheets}
        definedNames={model.definedNames ?? []}
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
        tableResizeDrag={tableResizeDrag}
        tableResizePreviewRange={tableResizePreviewRange}
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
        onSetTableResizeDrag={setTableResizeDrag}
        onStartTableResizeDrag={startTableResizeDrag}
      />
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}
