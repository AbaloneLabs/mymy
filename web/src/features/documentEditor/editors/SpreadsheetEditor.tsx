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
import { createSpreadsheetRangeActions } from "../spreadsheet";
import { addSpreadsheetSelectionRange } from "../spreadsheet";
import {
  SpreadsheetObjectStrip,
  SpreadsheetStatusBar,
} from "../spreadsheet";
import { SpreadsheetSheetTabs } from "../spreadsheet";
import {
  emptyViewport,
  rangeToA1,
  scrollCellIntoView,
  singleCellRange,
} from "../spreadsheet";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "../spreadsheet";
import {
  recalculateXlsxModel,
  xlsxColumnWidthPx,
  xlsxRowHeightPx,
} from "../spreadsheet";
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

  const objectEditors = createSpreadsheetObjectEditors({
    sheet,
    model,
    commitXlsxModel,
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
    commitXlsxModel,
    displaySheet,
    model,
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
    commitXlsxModel,
    displayGridSheet,
    displayRowLimit,
    model,
    objectEditors,
    selectionRange,
    sheet,
    validationRange,
  });

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
    await copySpreadsheetSelection({
      columnCount,
      displayGridSheet,
      selectedRanges,
      showFormulas,
    });
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
        activeCellFormulaMetadata={activeModelCell}
        activeCellDisabled={!activeCell}
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
