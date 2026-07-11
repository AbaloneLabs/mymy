import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { EditorCommandRequest } from "../shared/commands";
import { SpreadsheetDefinedNamesPanel } from "../spreadsheet";
import { copySpreadsheetSelection } from "../spreadsheet";
import { SpreadsheetGrid } from "../spreadsheet";
import { SpreadsheetFormulaDependencyPanel } from "../spreadsheet";
import { runSpreadsheetEditorCommand } from "../spreadsheet";
import { SpreadsheetToolbar } from "../spreadsheet";
import { spreadsheetTableResizeTargetRange } from "../spreadsheet";
import { deriveSpreadsheetEditorState } from "../spreadsheet";
import type {
  SpreadsheetFillDrag,
  SpreadsheetTableResizeDrag,
} from "../spreadsheet";
import { createSpreadsheetCellActions } from "../spreadsheet";
import { createSpreadsheetSheetActions } from "../spreadsheet";
import { canHideXlsxSheet, xlsxSheetDuplicateBlockReason } from "../spreadsheet";
import { createSpreadsheetRangeActions } from "../spreadsheet";
import { addSpreadsheetSelectionRange } from "../spreadsheet";
import {
  SpreadsheetObjectStrip,
  SpreadsheetStatusBar,
} from "../spreadsheet";
import { SpreadsheetSheetTabs } from "../spreadsheet";
import { SpreadsheetSheetDeletionDialog } from "../spreadsheet";
import type { XlsxSheetDeletionPreview } from "../spreadsheet";
import {
  emptyViewport,
  rangeToA1,
  parsedXlsxMergedRanges,
  scrollCellIntoView,
  singleCellRange,
  xlsxMergeAwareSelectionTarget,
} from "../spreadsheet";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "../spreadsheet";
import {
  applyXlsxClipboardPayload,
  recalculateXlsxModel,
  xlsxSortBlockReason,
  xlsxStructureEditBlockReason,
  xlsxColumnWidthPx,
  xlsxRowHeightPx,
} from "../spreadsheet";
import type { XlsxClipboardPayload } from "../spreadsheet";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type { XlsxDefinedName, XlsxModel } from "../shared/models";
import { createSpreadsheetObjectEditors } from "../spreadsheet";
import { handleSpreadsheetCellKeyDown } from "../spreadsheet";
import {
  selectSpreadsheetDefinedName,
  selectSpreadsheetReference,
} from "../spreadsheet";

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
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingSheetDeletion, setPendingSheetDeletion] =
    useState<XlsxSheetDeletionPreview | null>(null);
  const [columnResizePreview, setColumnResizePreview] = useState<{
    columnIndex: number;
    widthPx: number;
  } | null>(null);
  const [rowResizePreview, setRowResizePreview] = useState<{
    rowIndex: number;
    heightPx: number;
  } | null>(null);
  const resizeCancelRef = useRef<(() => void) | null>(null);
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
  const mergedRanges = parsedXlsxMergedRanges(sheet?.mergedRanges);
  const sortBlockReason = xlsxSortBlockReason(
    sheet,
    selectionRange,
    activeCell?.column,
    filterText,
  );
  const structureBlockReason = xlsxStructureEditBlockReason(sheet);
  const activeModelCell =
    sheet && activeCell
      ? normalizeXlsxCells(
          sheet.rows[activeCell.row]?.cells ?? [],
          columnCount,
          sheet.rows[activeCell.row]?.index || String(activeCell.row + 1),
        )[activeCell.column]
      : undefined;

  function commitXlsxModel(next: XlsxModel) {
    onChange(
      recalculateXlsxModel({
        ...next,
        definedNames:
          next.definedNames ?? model.definedNames?.map((definedName) => ({ ...definedName })),
      }),
    );
  }

  function commitActiveSheetMutation(next: XlsxModel) {
    if (sheet?.protection?.enabled) {
      setMutationError(
        "This sheet is protected. Disable protection before changing cells or objects.",
      );
      return;
    }
    setMutationError(null);
    commitXlsxModel(next);
  }

  const objectEditors = createSpreadsheetObjectEditors({
    sheet,
    model,
    commitXlsxModel: commitActiveSheetMutation,
  });
  const {
    addColumn,
    addRow,
    applyCellStyle,
    applyFillDrag,
    clearActiveCell,
    clearSelectedCellFormat,
    deleteActiveColumn,
    deleteActiveRow,
    fillDown,
    fillRight,
    sortRowsByActiveColumn,
    updateActiveColumnWidth,
    updateActiveRowHeight,
    updateCell,
    updateCellFormulaMetadata,
    updateCellsFromMatrix,
    updateColumnWidth,
    updateRowHeight,
  } = createSpreadsheetCellActions({
    activeCell,
    columnCount,
    commitXlsxModel: commitActiveSheetMutation,
    displaySheet,
    filterText,
    model,
    onMutationError: setMutationError,
    selectedRanges,
    selectionRange,
    setActiveCell,
    setExtraSelectionRanges,
    setSelectionAnchor,
    setSelectionEnd,
    sheet,
  });
  const {
    addDefinedNameFromSelection,
    addSheet,
    deleteDefinedName,
    deleteSheet,
    duplicateSheet,
    moveSheet,
    renameSheet,
    updateDefinedName,
    updateSheetState,
    updateSheetTabColor,
  } = createSpreadsheetSheetActions({
    activeDefinedNameValue,
    commitXlsxModel,
    model,
    selectionRange,
    setActiveCell,
    setPreferredSheetId,
    setSelectionAnchor,
    setSelectionEnd,
    sheet,
  });
  const {
    addChartSeriesFromSelection,
    applyComment,
    applyConditionalFormatting,
    applyDataValidation,
    applyHyperlink,
    clearAutoFilter,
    createTableFromSelection,
    hideSelectedColumns,
    hideSelectedRows,
    inferTableHeaders,
    mergeSelection,
    resizeTableToRange,
    resizeTableToSelection,
    setAutoFilterFromSelection,
    unhideAllRowsAndColumns,
    unmergeSelection,
    updateFrozenColumns,
    updateFrozenRows,
    updateSheetSettings,
  } = createSpreadsheetRangeActions({
    activeCell,
    columnCount,
    commitXlsxModel: commitActiveSheetMutation,
    commitSheetSettingsModel: commitXlsxModel,
    displayGridSheet,
    displayRowLimit,
    model,
    objectEditors,
    selectionRange,
    sheet,
    validationRange,
  });

  function selectCell(position: CellPosition, extend = false, additive = false) {
    const target = xlsxMergeAwareSelectionTarget(
      mergedRanges,
      position,
      selectionAnchor,
      extend,
    );
    setActiveCell(target.active);
    if (additive) {
      if (selectionRange) {
        setExtraSelectionRanges((current) =>
          addSpreadsheetSelectionRange(current, selectionRange),
        );
      }
      setSelectionAnchor(target.anchor);
      setSelectionEnd(target.end);
      return;
    }
    if (extend && selectionAnchor) {
      setSelectionEnd(target.end);
    } else {
      setExtraSelectionRanges([]);
      setSelectionAnchor(target.anchor);
      setSelectionEnd(target.end);
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
    const warning = await copySpreadsheetSelection({
      columnCount,
      displayGridSheet,
      rawSheet: sheet,
      selectedRanges,
      showFormulas,
    });
    setMutationError(warning);
  }

  function pasteXlsxClipboard(
    start: CellPosition,
    payload: XlsxClipboardPayload,
  ) {
    if (!sheet) return;
    const result = applyXlsxClipboardPayload(model, sheet.id, start, payload);
    if (!result.model) {
      setMutationError(result.reason);
      return;
    }
    setMutationError(null);
    commitActiveSheetMutation(result.model);
    const [primary, ...extra] = result.targetRanges;
    if (!primary) return;
    setActiveCell({ row: primary.top, column: primary.left });
    setSelectionAnchor({ row: primary.top, column: primary.left });
    setSelectionEnd({ row: primary.bottom, column: primary.right });
    setExtraSelectionRanges(extra);
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

  function startColumnResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    columnIndex: number,
  ) {
    if (!sheet || sheet.protection?.enabled) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidthPx = xlsxColumnWidthPx(sheet, columnIndex);
    let latestWidthPx = startWidthPx;
    let finished = false;
    resizeCancelRef.current?.();
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
      if (resizeCancelRef.current === handleCancel) resizeCancelRef.current = null;
    };
    const handleMove = (moveEvent: PointerEvent) => {
      latestWidthPx = Math.max(48, startWidthPx + moveEvent.clientX - startX);
      setColumnResizePreview({ columnIndex, widthPx: latestWidthPx });
    };
    const handleUp = () => {
      if (finished) return;
      finished = true;
      cleanup();
      setColumnResizePreview(null);
      if (latestWidthPx !== startWidthPx) {
        updateColumnWidth(columnIndex, (latestWidthPx - 12) / 7);
      }
    };
    const handleCancel = () => {
      if (finished) return;
      finished = true;
      cleanup();
      setColumnResizePreview(null);
    };
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      handleCancel();
    };
    resizeCancelRef.current = handleCancel;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
  }

  function startRowResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    rowIndex: number,
  ) {
    if (!sheet || sheet.protection?.enabled) return;
    if (!sheet.rows[rowIndex]) {
      setMutationError(
        `Row ${rowIndex + 1} is only a virtual empty row. Enter a value before resizing it.`,
      );
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeightPx = xlsxRowHeightPx(sheet.rows[rowIndex]);
    let latestHeightPx = startHeightPx;
    let finished = false;
    resizeCancelRef.current?.();
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
      if (resizeCancelRef.current === handleCancel) resizeCancelRef.current = null;
    };
    const handleMove = (moveEvent: PointerEvent) => {
      latestHeightPx = Math.max(24, startHeightPx + moveEvent.clientY - startY);
      setRowResizePreview({ rowIndex, heightPx: latestHeightPx });
    };
    const handleUp = () => {
      if (finished) return;
      finished = true;
      cleanup();
      setRowResizePreview(null);
      if (latestHeightPx !== startHeightPx) {
        updateRowHeight(rowIndex, latestHeightPx * 0.75);
      }
    };
    const handleCancel = () => {
      if (finished) return;
      finished = true;
      cleanup();
      setRowResizePreview(null);
    };
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      handleCancel();
    };
    resizeCancelRef.current = handleCancel;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
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
    function handleCancel() {
      setFillDrag(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleCancel();
    }
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fillDrag]);

  useEffect(() => {
    if (!tableResizeDrag) return;
    function handlePointerUp() {
      const drag = tableResizeDrag;
      setTableResizeDrag(null);
      if (drag) finishTableResizeDrag(drag);
    }
    function handleCancel() {
      setTableResizeDrag(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleCancel();
    }
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tableResizeDrag]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFillDrag(null);
      setTableResizeDrag(null);
      resizeCancelRef.current?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sheet?.id]);

  useEffect(() => {
    if (
      tableResizeDrag &&
      !sheet?.tables?.some((table) => table.id === tableResizeDrag.tableId)
    ) {
      const timer = window.setTimeout(() => setTableResizeDrag(null), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [sheet?.tables, tableResizeDrag]);

  useEffect(() => () => resizeCancelRef.current?.(), []);

  function selectReference(reference: string) {
    selectSpreadsheetReference(reference, {
      columnCount,
      displayRowLimit,
      gridElement: gridRef.current,
      model,
      setActiveCell,
      setPreferredSheetId,
      setSelectionAnchor,
      setSelectionEnd,
      sheet,
    });
  }

  function selectDefinedName(definedName: XlsxDefinedName) {
    selectSpreadsheetDefinedName(definedName, {
      columnCount,
      displayRowLimit,
      gridElement: gridRef.current,
      model,
      setActiveCell,
      setPreferredSheetId,
      setSelectionAnchor,
      setSelectionEnd,
      sheet,
    });
  }

  function focusCell(row: number, column: number) {
    const target = xlsxMergeAwareSelectionTarget(
      mergedRanges,
      { row, column },
      null,
      false,
    ).active;
    selectCell(target);
    scrollCellIntoView(gridRef.current, target.row, target.column);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-spreadsheet-cell="${target.row}:${target.column}"]`,
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
    handleSpreadsheetCellKeyDown(event, row, column, {
      activeCellStyle,
      applyCellStyle,
      columnCount,
      copySelection,
      displayRowLimit,
      fillDown,
      fillRight,
      focusCell,
      selectCell,
      setShowFormulas,
      updateCell,
    });
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {pendingSheetDeletion && (
        <SpreadsheetSheetDeletionDialog
          preview={pendingSheetDeletion}
          onCancel={() => setPendingSheetDeletion(null)}
          onConfirm={() => {
            const refreshedPreview = deleteSheet(pendingSheetDeletion);
            if (refreshedPreview) {
              setPendingSheetDeletion(refreshedPreview);
              setMutationError(
                "The deletion impact changed. Review the refreshed preview before confirming again.",
              );
              return;
            }
            setPendingSheetDeletion(null);
            setMutationError(null);
          }}
        />
      )}
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
        activeCellFormulaMetadata={activeModelCell}
        activeCellDisabled={!activeCell || sheet?.protection?.enabled === true}
        onActiveCellLabelChange={selectReference}
        onActiveCellChange={(value) => {
          if (!activeCell) return;
          updateCell(activeCell.row, activeCell.column, value);
        }}
        onActiveCellFormulaMetadataChange={(patch) => {
          if (!activeCell) return;
          updateCellFormulaMetadata(activeCell.row, activeCell.column, patch);
        }}
        onAddRow={addRow}
        onAddColumn={addColumn}
        canAddRow={!structureBlockReason}
        canAddColumn={!structureBlockReason}
        structureBlockReason={structureBlockReason}
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
            sheet.rows.length > 1 &&
            !structureBlockReason,
        )}
        canDeleteColumn={Boolean(activeCell && columnCount > 1 && !structureBlockReason)}
        canClearCell={Boolean(activeCell && !sheet?.protection?.enabled)}
        canCopy={selectedRanges.length > 0}
        canFillDown={Boolean(
          selectionRange &&
            selectionRange.bottom > selectionRange.top &&
            !sheet?.protection?.enabled,
        )}
        canFillRight={Boolean(
          selectionRange &&
            selectionRange.right > selectionRange.left &&
            !sheet?.protection?.enabled,
        )}
        canSetAutoFilter={Boolean(selectionRange && !sheet?.protection?.enabled)}
        canMerge={Boolean(
          selectionRange &&
            !singleCellRange(selectionRange) &&
            !sheet?.protection?.enabled,
        )}
        canUnmerge={Boolean(
          selectionRange &&
            sheet?.mergedRanges?.length &&
            !sheet.protection?.enabled,
        )}
        canCreateTable={Boolean(selectionRange && !sheet?.protection?.enabled)}
        canValidate={Boolean(validationRange && !sheet?.protection?.enabled)}
        canApplyConditionalFormatting={Boolean(
          validationRange && !sheet?.protection?.enabled,
        )}
        canApplyHyperlink={Boolean(validationRange && !sheet?.protection?.enabled)}
        canApplyComment={Boolean(validationRange && !sheet?.protection?.enabled)}
        canHide={Boolean(selectionRange && !sheet?.protection?.enabled)}
        canFormat={selectedRanges.length > 0 && !sheet?.protection?.enabled}
        canSort={!sortBlockReason}
        sortBlockReason={sortBlockReason}
      />
      {mutationError && (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-1.5 text-xs text-[var(--status-error)]"
        >
          No cells changed. {mutationError}
        </div>
      )}
      {sheet?.protection?.enabled && !mutationError && (
        <div className="shrink-0 border-b border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-3 py-1.5 text-xs text-[var(--status-warning)]">
          Protected sheet: cell, range, and object editing is read-only until protection is disabled.
        </div>
      )}
      <SpreadsheetSheetTabs
        sheets={model.sheets}
        activeSheet={sheet}
        onSelectSheet={(sheetId) => {
          setPendingSheetDeletion(null);
          setPreferredSheetId(sheetId);
          setActiveCell(null);
          setSelectionAnchor(null);
          setSelectionEnd(null);
          setExtraSelectionRanges([]);
        }}
        onAddSheet={addSheet}
        onDuplicateSheet={duplicateSheet}
        onDeleteSheet={() => {
          const preview = deleteSheet();
          if (preview) setPendingSheetDeletion(preview);
        }}
        onMoveSheet={moveSheet}
        onRenameSheet={renameSheet}
        onSheetStateChange={updateSheetState}
        onSheetTabColorChange={updateSheetTabColor}
        duplicateSheetBlockReason={xlsxSheetDuplicateBlockReason(sheet)}
        canChangeActiveSheetVisibility={Boolean(
          sheet && canHideXlsxSheet(model.sheets, sheet.id),
        )}
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
        readOnly={sheet?.protection?.enabled === true}
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
        readOnly={sheet?.protection?.enabled === true}
        columnResizePreview={columnResizePreview}
        rowResizePreview={rowResizePreview}
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
        onPasteXlsxClipboard={pasteXlsxClipboard}
        onSetFillDrag={setFillDrag}
        onStartFillDrag={startFillDrag}
        onSetTableResizeDrag={setTableResizeDrag}
        onStartTableResizeDrag={startTableResizeDrag}
      />
      <SpreadsheetStatusBar summary={selectionSummary} />
    </div>
  );
}
