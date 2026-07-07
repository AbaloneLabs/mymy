import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { EditorCommandRequest } from "../commands";
import { columnName, normalizeRow } from "../models";
import type { DelimitedTableModel } from "../models";
import {
  clipboardDataToMatrix,
  ensureDelimitedDisplayRows,
  ensureDelimitedRows,
  filteredDelimitedRows,
  rangeToClipboardText,
  sortDelimitedRows,
  valuesFromDelimitedRange,
} from "../spreadsheetData";
import {
  MIN_DELIMITED_VISIBLE_COLUMNS,
  MIN_DELIMITED_VISIBLE_ROWS,
  SPREADSHEET_COLUMN_WIDTH,
  SPREADSHEET_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  SPREADSHEET_ROW_HEIGHT,
  clampCellRange,
  emptyViewport,
  indexRange,
  normalizeCellRange,
  rangeCoversColumn,
  rangeCoversRow,
  rangeCoversSheet,
  rangeToA1,
  scrollCellIntoView,
  spacerColumnCount,
  viewportFromElement,
  virtualWindow,
  xlsxRangeFromRef,
} from "../spreadsheetGeometry";
import type { CellPosition, SpreadsheetViewport } from "../spreadsheetGeometry";
import { SpreadsheetColumnSpacer, SpreadsheetSpacerRow, SpreadsheetStatusBar } from "../spreadsheetPanels";
import {
  spreadsheetCellClass,
  spreadsheetDateStamp,
  spreadsheetTimeStamp,
  summarizeSelection,
} from "../spreadsheetPresentation";
import { SpreadsheetToolbar } from "./SpreadsheetEditor";

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

function delimitedLineEndingValue(value: string | undefined) {
  if (value === "\r\n" || value === "\r") return value;
  return "\n";
}
