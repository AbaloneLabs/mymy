import { useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { clipboardDataToMatrix } from "./spreadsheetData";
import { xlsxConditionalCellStyle } from "./spreadsheetConditionalFormatting";
import { spreadsheetRangeContainsCell } from "./spreadsheetEditorUtils";
import {
  SPREADSHEET_ROW_HEIGHT,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  spacerColumnCount,
  viewportFromElement,
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
  displayXlsxCellValue,
  xlsxColumnWidthPx,
  xlsxRowHeightPx,
} from "./spreadsheetXlsxModel";
import {
  xlsxCellHasComment,
  xlsxCellHasDataValidation,
  xlsxCellHasHyperlink,
} from "./spreadsheetXlsxMetadata";
import { columnName, normalizeXlsxCells } from "./models";
import type { XlsxRow, XlsxSheet } from "./models";

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
  showFormulas,
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
  onSetFillDrag,
  onStartFillDrag,
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
  showFormulas: boolean;
  onViewportChange: (viewport: SpreadsheetViewport) => void;
  onSelectAllCells: () => void;
  onSelectColumn: (column: number) => void;
  onSelectRow: (row: number) => void;
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
  onSetFillDrag: (drag: SpreadsheetFillDrag) => void;
  onStartFillDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    source: NormalizedCellRange,
  ) => void;
}) {
  const skipNextFocusSelectRef = useRef(false);

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
              onClick={onSelectAllCells}
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
                onClick={() => onSelectColumn(index)}
                className={cn(
                  "group relative sticky top-0 z-10 h-8 min-w-32 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-center font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                  rangeCoversColumn(selectionRange, index, displayRowLimit) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                  extraSelectionRanges.some((range) =>
                    rangeCoversColumn(range, index, displayRowLimit),
                  ) && "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
                style={{
                  minWidth: xlsxColumnWidthPx(sheet, index),
                  width: xlsxColumnWidthPx(sheet, index),
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
          {visibleRows.slice(rowWindow.start, rowWindow.end).map(({ row, rowIndex }) => (
            <tr
              key={`${sheet?.id ?? "sheet"}:${row.index}:${rowIndex}`}
              style={{ height: xlsxRowHeightPx(row) }}
            >
              <th
                onClick={() => onSelectRow(rowIndex)}
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
                const hasConditionalStyle = conditionalStyle.backgroundColor !== undefined;
                const inExtraSelection = extraSelectionRanges.some((range) =>
                  spreadsheetRangeContainsCell(range, rowIndex, cellIndex),
                );
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
                      inExtraSelection &&
                        "bg-[var(--accent)]/5 outline outline-1 outline-offset-[-1px] outline-[var(--accent)]/45",
                      mergedClass,
                      hasValidation &&
                        "shadow-[inset_0_-2px_0_rgba(132,204,22,0.55)]",
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
                      onChange={(event) =>
                        onUpdateCell(rowIndex, cellIndex, event.target.value)
                      }
                      onFocus={() => {
                        if (skipNextFocusSelectRef.current) {
                          skipNextFocusSelectRef.current = false;
                          return;
                        }
                        onSelectCell({ row: rowIndex, column: cellIndex });
                      }}
                      onMouseDown={(event) => {
                        skipNextFocusSelectRef.current = true;
                        window.setTimeout(() => {
                          skipNextFocusSelectRef.current = false;
                        }, 0);
                        onSelectCell(
                          { row: rowIndex, column: cellIndex },
                          event.shiftKey,
                          event.metaKey || event.ctrlKey,
                        );
                      }}
                      onMouseEnter={(event) => {
                        if (fillDrag && event.buttons === 1) {
                          onSetFillDrag({
                            ...fillDrag,
                            end: { row: rowIndex, column: cellIndex },
                          });
                          return;
                        }
                        if (event.buttons === 1) {
                          onSelectCell({ row: rowIndex, column: cellIndex }, true);
                        }
                      }}
                      onKeyDown={(event) => onCellKeyDown(event, rowIndex, cellIndex)}
                      onPaste={(event) => {
                        const matrix = clipboardDataToMatrix(event.clipboardData);
                        if (matrix) {
                          event.preventDefault();
                          onUpdateCellsFromMatrix(rowIndex, cellIndex, matrix);
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
                          onPointerDown={(event) => onStartFillDrag(event, selectionRange)}
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
