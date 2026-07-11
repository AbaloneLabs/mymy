import { useRef, useState } from "react";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { clipboardDataToMatrix } from "./spreadsheetData";
import {
  xlsxClipboardPayloadFromDataTransfer,
  type XlsxClipboardPayload,
} from "./spreadsheetXlsxClipboard";
import { spreadsheetCellEditCommitValue } from "./spreadsheetCellEditTransaction";
import { xlsxConditionalCellStyle } from "./spreadsheetConditionalFormatting";
import { spreadsheetRangeContainsCell } from "./spreadsheetEditorUtils";
import {
  SPREADSHEET_ROW_HEIGHT,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  spacerColumnCount,
  viewportFromElement,
  xlsxRangeFromRef,
} from "./spreadsheetGeometry";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "./spreadsheetGeometry";
import {
  spreadsheetCellClass,
  xlsxCellInputStyle,
  xlsxHyperlinkCellStyle,
  xlsxMergedCellClass,
} from "./spreadsheetPresentation";
import {
  SpreadsheetColumnSpacer,
  SpreadsheetSpacerRow,
} from "./spreadsheetPanels";
import {
  formulaBarXlsxCellValue,
  xlsxColumnWidthPx,
  xlsxRowHeightPx,
} from "./spreadsheetXlsxGridModel";
import { renderedXlsxCellValue } from "./spreadsheetNumberFormat";
import {
  parsedXlsxMergedRanges,
  xlsxMergeFragmentForCell,
  xlsxMergedRangeForCell,
} from "./spreadsheetMerges";
import {
  xlsxCellHasComment,
  xlsxCellHasDataValidation,
  xlsxCellHasHyperlink,
} from "./spreadsheetXlsxMetadata";
import { columnName, normalizeXlsxCells } from "../shared/models";
import type { XlsxRow, XlsxSheet } from "../shared/models";

type SpreadsheetWindow = {
  start: number;
  end: number;
};

type VisibleSpreadsheetRow = {
  row: XlsxRow;
  rowIndex: number;
};

type SpreadsheetFillDrag = {
  source: NormalizedCellRange;
  end: CellPosition;
};

type SpreadsheetTableResizeDrag = {
  tableId: string;
  source: NormalizedCellRange;
  end: CellPosition;
};

export function SpreadsheetGrid({
  gridRef,
  sheet,
  displaySheet,
  displayRowLimit,
  columnCount,
  visibleColumns,
  visibleColumnIndexes,
  visibleRows,
  rowWindow,
  columnWindow,
  leftColumnSpacerWidth,
  rightColumnSpacerWidth,
  activeCell,
  selectionRange,
  extraSelectionRanges,
  fillDrag,
  fillPreviewRange,
  tableResizeDrag,
  tableResizePreviewRange,
  showFormulas,
  readOnly,
  columnResizePreview,
  rowResizePreview,
  onViewportChange,
  onSelectAllCells,
  onSelectColumn,
  onSelectRow,
  onStartColumnResize,
  onStartRowResize,
  onUpdateCell,
  onSelectCell,
  onCellKeyDown,
  onUpdateCellsFromMatrix,
  onPasteXlsxClipboard,
  onSetFillDrag,
  onStartFillDrag,
  onSetTableResizeDrag,
  onStartTableResizeDrag,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  sheet: XlsxSheet | undefined;
  displaySheet: XlsxSheet | undefined;
  displayRowLimit: number;
  columnCount: number;
  visibleColumns: number[];
  visibleColumnIndexes: number[];
  visibleRows: VisibleSpreadsheetRow[];
  rowWindow: SpreadsheetWindow;
  columnWindow: SpreadsheetWindow;
  leftColumnSpacerWidth: number;
  rightColumnSpacerWidth: number;
  activeCell: CellPosition | null;
  selectionRange: NormalizedCellRange | null;
  extraSelectionRanges: NormalizedCellRange[];
  fillDrag: SpreadsheetFillDrag | null;
  fillPreviewRange: NormalizedCellRange | null;
  tableResizeDrag: SpreadsheetTableResizeDrag | null;
  tableResizePreviewRange: NormalizedCellRange | null;
  showFormulas: boolean;
  readOnly: boolean;
  columnResizePreview: { columnIndex: number; widthPx: number } | null;
  rowResizePreview: { rowIndex: number; heightPx: number } | null;
  onViewportChange: (viewport: SpreadsheetViewport) => void;
  onSelectAllCells: (additive?: boolean) => void;
  onSelectColumn: (column: number, extend?: boolean, additive?: boolean) => void;
  onSelectRow: (row: number, extend?: boolean, additive?: boolean) => void;
  onStartColumnResize: (
    event: ReactPointerEvent<HTMLButtonElement>,
    columnIndex: number,
  ) => void;
  onStartRowResize: (
    event: ReactPointerEvent<HTMLButtonElement>,
    rowIndex: number,
  ) => void;
  onUpdateCell: (rowIndex: number, cellIndex: number, value: string) => void;
  onSelectCell: (
    position: CellPosition,
    extend?: boolean,
    additive?: boolean,
  ) => void;
  onCellKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    cellIndex: number,
  ) => void;
  onUpdateCellsFromMatrix: (
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) => void;
  onPasteXlsxClipboard: (
    start: CellPosition,
    payload: XlsxClipboardPayload,
  ) => void;
  onSetFillDrag: (drag: SpreadsheetFillDrag) => void;
  onStartFillDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    source: NormalizedCellRange,
  ) => void;
  onSetTableResizeDrag: (drag: SpreadsheetTableResizeDrag) => void;
  onStartTableResizeDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    tableId: string,
    source: NormalizedCellRange,
  ) => void;
}) {
  const skipNextFocusSelectRef = useRef(false);
  const tableRanges = (sheet?.tables ?? [])
    .map((table) => ({
      tableId: table.id,
      range: xlsxRangeFromRef(table.ref ?? ""),
    }))
    .filter(
      (record): record is { tableId: string; range: NormalizedCellRange } =>
        record.range !== null,
    );
  const renderedRows = visibleRows.slice(rowWindow.start, rowWindow.end);
  const renderedRowIndexes = renderedRows.map((record) => record.rowIndex);
  const renderedRowByIndex = new Map(
    renderedRows.map((record) => [record.rowIndex, record.row]),
  );
  const mergedRanges = parsedXlsxMergedRanges(sheet?.mergedRanges);
  const columnWidthPx = (index: number) =>
    columnResizePreview?.columnIndex === index
      ? columnResizePreview.widthPx
      : xlsxColumnWidthPx(sheet, index);
  const rowHeightPx = (item: XlsxRow, index: number) =>
    rowResizePreview?.rowIndex === index
      ? rowResizePreview.heightPx
      : xlsxRowHeightPx(item);

  return (
    <div
      ref={gridRef}
      onScroll={(event) => onViewportChange(viewportFromElement(event.currentTarget))}
      className="min-h-0 flex-1 overflow-auto p-4"
    >
      <table className="border-collapse text-xs shadow-sm">
        <thead>
          <tr>
            <th
              onClick={(event) =>
                onSelectAllCells(event.metaKey || event.ctrlKey)
              }
              className={cn(
                "sticky left-0 top-0 z-20 h-8 min-w-12 cursor-pointer border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                rangeCoversSheet(selectionRange, displayRowLimit, columnCount) &&
                  "bg-[var(--accent)]/10 text-[var(--accent)]",
                extraSelectionRanges.some((range) =>
                  rangeCoversSheet(range, displayRowLimit, columnCount),
                ) && "bg-[var(--accent)]/10 text-[var(--accent)]",
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
                onClick={(event) =>
                  onSelectColumn(
                    index,
                    event.shiftKey,
                    event.metaKey || event.ctrlKey,
                  )
                }
                className={cn(
                  "group relative sticky top-0 z-10 h-8 min-w-32 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-center font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                  rangeCoversColumn(selectionRange, index, displayRowLimit) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                  extraSelectionRanges.some((range) =>
                    rangeCoversColumn(range, index, displayRowLimit),
                  ) && "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
                style={{
                  minWidth: columnWidthPx(index),
                  width: columnWidthPx(index),
                }}
              >
                {columnName(index)}
                <button
                  type="button"
                  onPointerDown={(event) => onStartColumnResize(event, index)}
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
              columnSpan={
                visibleColumnIndexes.length +
                spacerColumnCount(columnWindow, visibleColumns.length)
              }
            />
          )}
          {renderedRows.map(({ row, rowIndex }) => (
            <tr
              key={`${sheet?.id ?? "sheet"}:${row.index}:${rowIndex}`}
              style={{ height: rowHeightPx(row, rowIndex) }}
            >
              <th
                onClick={(event) =>
                  onSelectRow(
                    rowIndex,
                    event.shiftKey,
                    event.metaKey || event.ctrlKey,
                  )
                }
                className={cn(
                  "group relative sticky left-0 z-10 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                  rangeCoversRow(selectionRange, rowIndex, columnCount) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                  extraSelectionRanges.some((range) =>
                    rangeCoversRow(range, rowIndex, columnCount),
                  ) && "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
              >
                {row.index || rowIndex + 1}
                <button
                  type="button"
                  onPointerDown={(event) => onStartRowResize(event, rowIndex)}
                  className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize opacity-0 hover:bg-[var(--accent)]/30 group-hover:opacity-100"
                  title="Resize row"
                />
              </th>
              {columnWindow.start > 0 && (
                <SpreadsheetColumnSpacer width={leftColumnSpacerWidth} />
              )}
              {visibleColumnIndexes.map((cellIndex) => {
                const mergedRange = xlsxMergedRangeForCell(
                  mergedRanges,
                  rowIndex,
                  cellIndex,
                );
                const mergeFragment = mergedRange
                  ? xlsxMergeFragmentForCell(
                      mergedRange,
                      renderedRowIndexes,
                      visibleColumnIndexes,
                      rowIndex,
                      cellIndex,
                    )
                  : null;
                if (mergeFragment && !mergeFragment.isFragmentAnchor) return null;
                const targetRowIndex = mergeFragment?.anchor.row ?? rowIndex;
                const targetCellIndex = mergeFragment?.anchor.column ?? cellIndex;
                const displayRow =
                  displaySheet?.rows[targetRowIndex] ??
                  (targetRowIndex === rowIndex ? row : undefined);
                const cell = normalizeXlsxCells(
                  displayRow?.cells ?? [],
                  targetCellIndex + 1,
                  displayRow?.index || String(targetRowIndex + 1),
                )[targetCellIndex];
                const rawRow = sheet?.rows[targetRowIndex];
                const rawCell = normalizeXlsxCells(
                  rawRow?.cells ?? [],
                  targetCellIndex + 1,
                  rawRow?.index || String(targetRowIndex + 1),
                )[targetCellIndex];
                const mergedClass = xlsxMergedCellClass(
                  sheet?.mergedRanges,
                  targetRowIndex,
                  targetCellIndex,
                );
                const hasValidation = xlsxCellHasDataValidation(
                  sheet?.dataValidations,
                  targetRowIndex,
                  targetCellIndex,
                );
                const hasHyperlink = xlsxCellHasHyperlink(
                  sheet?.hyperlinks,
                  targetRowIndex,
                  targetCellIndex,
                );
                const hasComment = xlsxCellHasComment(
                  sheet?.comments,
                  targetRowIndex,
                  targetCellIndex,
                );
                const conditionalStyle = xlsxConditionalCellStyle(
                  sheet?.conditionalFormattings,
                  displaySheet,
                  targetRowIndex,
                  targetCellIndex,
                  cell,
                  columnCount,
                );
                const hasConditionalStyle = conditionalStyle.backgroundColor !== undefined;
                const inExtraSelection = extraSelectionRanges.some((range) =>
                  spreadsheetRangeContainsCell(
                    range,
                    targetRowIndex,
                    targetCellIndex,
                  ),
                );
                const tableRecord = tableRanges.find((record) =>
                  spreadsheetRangeContainsCell(
                    record.range,
                    targetRowIndex,
                    targetCellIndex,
                  ),
                );
                const tableRange = tableRecord?.range;
                const tableBottomRight =
                  tableRange?.bottom === targetRowIndex &&
                  tableRange.right === targetCellIndex;
                const mergedWidth = mergeFragment?.columnIndexes.reduce(
                  (total, index) => total + columnWidthPx(index),
                  0,
                );
                const mergedHeight = mergeFragment?.rowIndexes.reduce(
                  (total, index) =>
                    total +
                    rowHeightPx(renderedRowByIndex.get(index) ?? row, index),
                  0,
                );
                const selectionEndsAtCell = Boolean(
                  selectionRange &&
                    selectionRange.bottom ===
                      (mergeFragment?.range.bottom ?? rowIndex) &&
                    selectionRange.right ===
                      (mergeFragment?.range.right ?? cellIndex),
                );
                return (
                  <td
                    key={`${cell.ref}:${rowIndex}:${cellIndex}`}
                    colSpan={mergeFragment?.colSpan}
                    rowSpan={mergeFragment?.rowSpan}
                    className={cn(
                      "relative",
                      spreadsheetCellClass(
                        activeCell,
                        selectionRange,
                        targetRowIndex,
                        targetCellIndex,
                      ),
                      inExtraSelection &&
                        "bg-[var(--accent)]/5 outline outline-1 outline-offset-[-1px] outline-[var(--accent)]/45",
                      mergedClass,
                      hasValidation &&
                        "shadow-[inset_0_-2px_0_rgba(132,204,22,0.55)]",
                      hasConditionalStyle &&
                        "shadow-[inset_0_0_0_1px_rgba(132,204,22,0.35)]",
                      fillPreviewRange &&
                        spreadsheetRangeContainsCell(
                          fillPreviewRange,
                          targetRowIndex,
                          targetCellIndex,
                        ) &&
                        "outline outline-1 outline-offset-[-1px] outline-[rgba(132,204,22,0.75)]",
                      tableRange &&
                        "shadow-[inset_0_0_0_1px_rgba(14,165,233,0.18)]",
                      tableRange?.top === targetRowIndex &&
                        "border-t-sky-400/70",
                      tableRange?.bottom === targetRowIndex &&
                        "border-b-sky-400/70",
                      tableRange?.left === targetCellIndex &&
                        "border-l-sky-400/70",
                      tableRange?.right === targetCellIndex &&
                        "border-r-sky-400/70",
                      tableResizePreviewRange &&
                        spreadsheetRangeContainsCell(
                          tableResizePreviewRange,
                          targetRowIndex,
                          targetCellIndex,
                        ) &&
                        "outline outline-1 outline-offset-[-1px] outline-sky-400",
                    )}
                  >
                    {hasComment && (
                      <span className="pointer-events-none absolute right-0 top-0 z-10 h-0 w-0 border-l-[8px] border-l-transparent border-t-[8px] border-t-amber-400" />
                    )}
                    <SpreadsheetCellEditor
                      readOnly={readOnly}
                      data-spreadsheet-cell={`${targetRowIndex}:${targetCellIndex}`}
                      rawValue={formulaBarXlsxCellValue(rawCell)}
                      displayValue={renderedXlsxCellValue(cell, showFormulas)}
                      onValueChange={(value) =>
                        onUpdateCell(targetRowIndex, targetCellIndex, value)
                      }
                      onFocus={() => {
                        if (skipNextFocusSelectRef.current) {
                          skipNextFocusSelectRef.current = false;
                          return;
                        }
                        onSelectCell({
                          row: targetRowIndex,
                          column: targetCellIndex,
                        });
                      }}
                      onMouseDown={(event) => {
                        skipNextFocusSelectRef.current = true;
                        window.setTimeout(() => {
                          skipNextFocusSelectRef.current = false;
                        }, 0);
                        onSelectCell(
                          { row: targetRowIndex, column: targetCellIndex },
                          event.shiftKey,
                          event.metaKey || event.ctrlKey,
                        );
                      }}
                      onMouseEnter={(event) => {
                        if (tableResizeDrag && event.buttons === 1) {
                          onSetTableResizeDrag({
                            ...tableResizeDrag,
                            end: {
                              row: mergeFragment?.range.bottom ?? rowIndex,
                              column: mergeFragment?.range.right ?? cellIndex,
                            },
                          });
                          return;
                        }
                        if (fillDrag && event.buttons === 1) {
                          onSetFillDrag({
                            ...fillDrag,
                            end: {
                              row: mergeFragment?.range.bottom ?? rowIndex,
                              column: mergeFragment?.range.right ?? cellIndex,
                            },
                          });
                          return;
                        }
                        if (event.buttons === 1) {
                          onSelectCell(
                            { row: targetRowIndex, column: targetCellIndex },
                            true,
                          );
                        }
                      }}
                      onKeyDown={(event) =>
                        onCellKeyDown(event, targetRowIndex, targetCellIndex)
                      }
                      onPaste={(event) => {
                        const rich = xlsxClipboardPayloadFromDataTransfer(
                          event.clipboardData,
                        );
                        if (rich) {
                          event.preventDefault();
                          onPasteXlsxClipboard(
                            { row: targetRowIndex, column: targetCellIndex },
                            rich,
                          );
                          return;
                        }
                        const matrix = clipboardDataToMatrix(event.clipboardData);
                        if (matrix) {
                          event.preventDefault();
                          onUpdateCellsFromMatrix(
                            targetRowIndex,
                            targetCellIndex,
                            matrix,
                          );
                        }
                      }}
                      className={cn(
                        "h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]",
                        mergedClass,
                      )}
                      style={{
                        minWidth:
                          mergedWidth ?? columnWidthPx(cellIndex),
                        width: mergedWidth ?? columnWidthPx(cellIndex),
                        height: mergedHeight ?? rowHeightPx(row, rowIndex),
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
                        mergeFragment
                          ? `merged ${mergeFragment.range.top + 1}:${mergeFragment.range.bottom + 1}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                    {selectionRange && selectionEndsAtCell && (
                        <button
                          type="button"
                          onPointerDown={(event) => onStartFillDrag(event, selectionRange)}
                          className="absolute bottom-0 right-0 z-20 h-2.5 w-2.5 translate-x-1/2 translate-y-1/2 cursor-crosshair border border-white bg-[var(--accent)] shadow-sm"
                          title="Fill handle"
                          aria-label="Fill handle"
                        />
                      )}
                    {tableRecord && tableRange && tableBottomRight && (
                      <button
                        type="button"
                        onPointerDown={(event) =>
                          onStartTableResizeDrag(
                            event,
                            tableRecord.tableId,
                            tableRange,
                          )
                        }
                        className="absolute bottom-0 right-0 z-30 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize border border-white bg-sky-500 shadow-sm"
                        title="Resize table"
                        aria-label="Resize table"
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
              columnSpan={
                visibleColumnIndexes.length +
                spacerColumnCount(columnWindow, visibleColumns.length)
              }
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

type SpreadsheetCellEditorProps = Omit<
  ComponentProps<"input">,
  "defaultValue" | "onChange" | "value"
> & {
  displayValue: string;
  rawValue: string;
  onValueChange: (value: string) => void;
};

/**
 * Keep formatted display text out of the mutation path. A passive cell may
 * show currency, percent, or a formula result, but focus always switches to an
 * edit-local raw/formula value. The workbook changes once on commit; Escape
 * discards the preview without adding a compensating history entry.
 */
function SpreadsheetCellEditor({
  displayValue,
  rawValue,
  onValueChange,
  onFocus,
  onBlur,
  onKeyDown,
  ...inputProps
}: SpreadsheetCellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(rawValue);
  const originalValueRef = useRef(rawValue);
  const cancelledRef = useRef(false);

  return (
    <input
      {...inputProps}
      value={editing ? editValue : displayValue}
      onFocus={(event) => {
        originalValueRef.current = rawValue;
        cancelledRef.current = false;
        setEditValue(rawValue);
        setEditing(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        const committed = spreadsheetCellEditCommitValue(
          originalValueRef.current,
          editValue,
          cancelledRef.current,
        );
        cancelledRef.current = false;
        setEditing(false);
        if (committed !== null) onValueChange(committed);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setEditValue(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelledRef.current = true;
          const original = originalValueRef.current;
          setEditValue(original);
          event.currentTarget.blur();
          return;
        }
        onKeyDown?.(event);
      }}
    />
  );
}
