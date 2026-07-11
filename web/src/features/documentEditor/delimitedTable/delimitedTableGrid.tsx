import type {
  ClipboardEventHandler,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEventHandler,
  RefObject,
} from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { normalizeRow } from "../shared/models";
import { clipboardDataToMatrix } from "../spreadsheet";
import {
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  indexRange,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  spacerColumnCount,
  viewportFromElement,
} from "../spreadsheet";
import type {
  CellPosition,
  NormalizedCellRange,
  SpreadsheetViewport,
} from "../spreadsheet";
import {
  SpreadsheetColumnSpacer,
  SpreadsheetSpacerRow,
} from "../spreadsheet";
import { spreadsheetCellClass } from "../spreadsheet";
import { delimitedColumnHeader } from "./delimitedTableUtils";

interface DelimitedTableGridProps {
  gridRef: RefObject<HTMLDivElement | null>;
  activeCell: CellPosition | null;
  selectionRange: NormalizedCellRange | null;
  sourceRows: string[][];
  headerRow: boolean;
  columnCount: number;
  displayRowLimit: number;
  rowWindow: { start: number; end: number };
  columnWindow: { start: number; end: number };
  visibleRows: Array<{ row: string[]; rowIndex: number }>;
  onViewportChange: (viewport: SpreadsheetViewport) => void;
  onSelectAllCells: () => void;
  onSelectColumn: (column: number) => void;
  onSelectRow: (row: number) => void;
  onSelectCell: (position: CellPosition, extend?: boolean) => void;
  onSetActiveCell: (position: CellPosition) => void;
  onUpdateCell: (rowIndex: number, columnIndex: number, value: string) => void;
  onUpdateCellsFromMatrix: (
    startRow: number,
    startColumn: number,
    matrix: string[][],
  ) => void;
  onCellKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    row: number,
    column: number,
  ) => void;
}

export function DelimitedTableGrid({
  gridRef,
  activeCell,
  selectionRange,
  sourceRows,
  headerRow,
  columnCount,
  displayRowLimit,
  rowWindow,
  columnWindow,
  visibleRows,
  onViewportChange,
  onSelectAllCells,
  onSelectColumn,
  onSelectRow,
  onSelectCell,
  onSetActiveCell,
  onUpdateCell,
  onUpdateCellsFromMatrix,
  onCellKeyDown,
}: DelimitedTableGridProps) {
  const { t } = useTranslation();
  const visibleColumnIndexes = indexRange(columnWindow.start, columnWindow.end);

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
                onClick={() => onSelectColumn(columnIndex)}
                className={cn(
                  "sticky top-0 z-10 h-8 min-w-32 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-center font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
                  rangeCoversColumn(selectionRange, columnIndex, displayRowLimit) &&
                    "bg-[var(--accent)]/10 text-[var(--accent)]",
                )}
              >
                <span className="block truncate">
                  {delimitedColumnHeader(columnIndex, sourceRows, headerRow)}
                </span>
              </th>
            ))}
            {columnWindow.end < columnCount && (
              <th
                aria-hidden="true"
                className="sticky top-0 z-10 h-8 border border-transparent bg-[var(--surface)]"
                style={{
                  minWidth: (columnCount - columnWindow.end) * SPREADSHEET_COLUMN_WIDTH,
                }}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {rowWindow.start > 0 && (
            <SpreadsheetSpacerRow
              height={rowWindow.start * SPREADSHEET_ROW_HEIGHT}
              columnSpan={
                visibleColumnIndexes.length + spacerColumnCount(columnWindow, columnCount)
              }
            />
          )}
          {visibleRows.slice(rowWindow.start, rowWindow.end).map(({ row, rowIndex }) => {
            const normalized = normalizeRow(row, columnCount);
            return (
              <tr key={rowIndex}>
                <th
                  onClick={() => onSelectRow(rowIndex)}
                  className={cn(
                    "sticky left-0 z-10 cursor-pointer border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)] hover:bg-[var(--surface-hover)]",
                    rangeCoversRow(selectionRange, rowIndex, columnCount) &&
                      "bg-[var(--accent)]/10 text-[var(--accent)]",
                  )}
                >
                  {rowIndex + 1}
                </th>
                {columnWindow.start > 0 && (
                  <SpreadsheetColumnSpacer
                    width={columnWindow.start * SPREADSHEET_COLUMN_WIDTH}
                  />
                )}
                {normalized
                  .slice(columnWindow.start, columnWindow.end)
                  .map((cell, offset) => {
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
                        <DelimitedCellInput
                          key={`${rowIndex}:${columnIndex}:${cell}`}
                          data-delimited-cell={`${rowIndex}:${columnIndex}`}
                          value={cell}
                          onCommit={(value) =>
                            onUpdateCell(rowIndex, columnIndex, value)
                          }
                          onFocus={() =>
                            onSetActiveCell({ row: rowIndex, column: columnIndex })
                          }
                          onMouseDown={(event) =>
                            onSelectCell(
                              { row: rowIndex, column: columnIndex },
                              event.shiftKey,
                            )
                          }
                          onMouseEnter={(event) => {
                            if (event.buttons === 1) {
                              onSelectCell({ row: rowIndex, column: columnIndex }, true);
                            }
                          }}
                          onKeyDown={(event) => onCellKeyDown(event, rowIndex, columnIndex)}
                          onPaste={(event) => {
                            const matrix = clipboardDataToMatrix(event.clipboardData);
                            if (matrix) {
                              event.preventDefault();
                              onUpdateCellsFromMatrix(rowIndex, columnIndex, matrix);
                            }
                          }}
                          aria-label={t("documentEditor.cellLabel", {
                            row: rowIndex + 1,
                            column: columnIndex + 1,
                          })}
                        />
                      </td>
                    );
                  })}
                {columnWindow.end < columnCount && (
                  <SpreadsheetColumnSpacer
                    width={(columnCount - columnWindow.end) * SPREADSHEET_COLUMN_WIDTH}
                  />
                )}
              </tr>
            );
          })}
          {rowWindow.end < visibleRows.length && (
            <SpreadsheetSpacerRow
              height={(visibleRows.length - rowWindow.end) * SPREADSHEET_ROW_HEIGHT}
              columnSpan={
                visibleColumnIndexes.length + spacerColumnCount(columnWindow, columnCount)
              }
            />
          )}
        </tbody>
      </table>
    </div>
  );
}

function DelimitedCellInput({
  value,
  onCommit,
  onFocus,
  onMouseDown,
  onMouseEnter,
  onKeyDown,
  onPaste,
  ...inputProps
}: {
  value: string;
  onCommit: (value: string) => void;
  onFocus: () => void;
  onMouseDown: MouseEventHandler<HTMLInputElement>;
  onMouseEnter: MouseEventHandler<HTMLInputElement>;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPaste: ClipboardEventHandler<HTMLInputElement>;
  "data-delimited-cell": string;
  "aria-label": string;
}) {
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);

  return (
    <input
      {...inputProps}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={() => {
        cancelledRef.current = false;
        setDraft(value);
        onFocus();
      }}
      onBlur={() => {
        if (!cancelledRef.current && draft !== value) onCommit(draft);
        cancelledRef.current = false;
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelledRef.current = true;
          setDraft(value);
          event.currentTarget.blur();
          return;
        }
        onKeyDown(event);
      }}
      onPaste={onPaste}
      className="h-8 min-w-32 bg-[var(--bg)] px-2 text-[var(--text)] outline-none focus:bg-[var(--surface)]"
    />
  );
}
