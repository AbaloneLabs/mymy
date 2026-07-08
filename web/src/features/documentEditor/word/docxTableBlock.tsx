import { useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { columnName } from "../shared/models";
import type { DocxBlock } from "../shared/models";
import {
  DEFAULT_DOCX_TABLE_BACKGROUND,
  DEFAULT_DOCX_TABLE_BORDER_COLOR,
  DEFAULT_DOCX_TABLE_BORDER_SIZE,
  DEFAULT_DOCX_TABLE_HEADER_BACKGROUND,
  MIN_DOCX_TABLE_COLUMN_WIDTH,
  MIN_DOCX_TABLE_ROW_HEIGHT,
  clampTableCell,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRow,
  normalizeDocxTableRowHeights,
  tableClipboardMatrix,
  tableColumnCount,
  twipsToCssPixels,
} from "./docxEditorUtils";
import {
  isDocxTableCellCovered,
  mergedRangeForCell,
} from "./docxTableOperations";
import { DocxTableActionToolbar } from "./docxTableActionToolbar";

export function DocxTableBlock({
  block,
  active,
  onFocus,
  onCellChange,
  onAddRow,
  onAddColumn,
  onInsertRow,
  onInsertColumn,
  onDuplicateRow,
  onDuplicateColumn,
  onMoveRow,
  onMoveColumn,
  onColumnWidthChange,
  onRowHeightChange,
  onStyleChange,
  onDeleteRow,
  onDeleteColumn,
  onClearCell,
  onMergeCellRight,
  onMergeCellDown,
  onSplitCell,
  onPasteCells,
}: {
  block: DocxBlock;
  active: boolean;
  onFocus: () => void;
  onCellChange: (row: number, column: number, value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onInsertRow: (row: number, position: "above" | "below") => void;
  onInsertColumn: (column: number, position: "left" | "right") => void;
  onDuplicateRow: (row: number) => void;
  onDuplicateColumn: (column: number) => void;
  onMoveRow: (row: number, direction: -1 | 1) => void;
  onMoveColumn: (column: number, direction: -1 | 1) => void;
  onColumnWidthChange: (column: number, width: number) => void;
  onRowHeightChange: (row: number, height: number) => void;
  onStyleChange: (patch: Partial<DocxBlock>) => void;
  onDeleteRow: (row: number) => void;
  onDeleteColumn: (column: number) => void;
  onClearCell: (row: number, column: number) => void;
  onMergeCellRight: (row: number, column: number) => void;
  onMergeCellDown: (row: number, column: number) => void;
  onSplitCell: (row: number, column: number) => void;
  onPasteCells: (row: number, column: number, matrix: string[][]) => void;
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; column: number } | null>(
    null,
  );
  const rows = block.rows && block.rows.length > 0 ? block.rows : [[""]];
  const columns = tableColumnCount(rows);
  const normalizedRows = rows.map((row) => normalizeDocxTableRow(row, columns));
  const columnWidths = normalizeDocxTableColumnWidths(
    block.tableColumnWidths,
    columns,
  );
  const rowHeights = normalizeDocxTableRowHeights(
    block.tableRowHeights,
    normalizedRows.length,
  );
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const selectedCell = clampTableCell(activeCell, normalizedRows.length, columns);
  const tableBorderColor =
    block.tableBorderColor ?? DEFAULT_DOCX_TABLE_BORDER_COLOR;
  const tableBorderSize =
    block.tableBorderSize ?? DEFAULT_DOCX_TABLE_BORDER_SIZE;
  const tableCellBackground =
    block.tableCellBackground ?? DEFAULT_DOCX_TABLE_BACKGROUND;
  const tableHeaderBackground =
    block.tableHeaderBackground ?? DEFAULT_DOCX_TABLE_HEADER_BACKGROUND;
  const tableCellVerticalAlign = block.tableCellVerticalAlign ?? "top";
  const selectedMergedRange = selectedCell
    ? mergedRangeForCell(block, selectedCell.row, selectedCell.column)
    : undefined;
  const selectedRange = selectedCell
    ? (selectedMergedRange ?? {
        row: selectedCell.row,
        column: selectedCell.column,
        rowSpan: 1,
        colSpan: 1,
      })
    : undefined;
  const canMergeRight = Boolean(
    selectedRange && selectedRange.column + selectedRange.colSpan < columns,
  );
  const canMergeDown = Boolean(
    selectedRange &&
      selectedRange.row + selectedRange.rowSpan < normalizedRows.length,
  );
  const canSplitCell = Boolean(
    selectedMergedRange &&
      (selectedMergedRange.rowSpan > 1 || selectedMergedRange.colSpan > 1),
  );

  function selectCell(row: number, column: number) {
    setActiveCell({ row, column });
    onFocus();
  }

  function focusCell(row: number, column: number) {
    const target = clampTableCell({ row, column }, normalizedRows.length, columns);
    if (!target) return;
    setActiveCell(target);
    requestAnimationFrame(() => {
      const textarea = tableRef.current?.querySelector<HTMLTextAreaElement>(
        `textarea[data-docx-cell="${target.row}:${target.column}"]`,
      );
      textarea?.focus();
      textarea?.select();
    });
  }

  function startColumnResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    columnIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[columnIndex];
    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        MIN_DOCX_TABLE_COLUMN_WIDTH,
        startWidth + (moveEvent.clientX - startX) * 15,
      );
      onColumnWidthChange(columnIndex, nextWidth);
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
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = rowHeights[rowIndex];
    const handleMove = (moveEvent: PointerEvent) => {
      const nextHeight = Math.max(
        MIN_DOCX_TABLE_ROW_HEIGHT,
        startHeight + (moveEvent.clientY - startY) * 15,
      );
      onRowHeightChange(rowIndex, nextHeight);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
    columnIndex: number,
  ) {
    const primary = event.ctrlKey || event.metaKey;
    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const linearIndex = rowIndex * columns + columnIndex + direction;
      if (linearIndex < 0) {
        focusCell(0, 0);
        return;
      }
      if (linearIndex >= normalizedRows.length * columns) {
        onInsertRow(rowIndex, "below");
        focusCell(rowIndex + 1, 0);
        return;
      }
      focusCell(Math.floor(linearIndex / columns), linearIndex % columns);
      return;
    }
    if (primary && event.key === "Enter") {
      event.preventDefault();
      onInsertRow(rowIndex, event.shiftKey ? "above" : "below");
      focusCell(event.shiftKey ? rowIndex : rowIndex + 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      onMoveRow(rowIndex, -1);
      focusCell(rowIndex - 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      onMoveRow(rowIndex, 1);
      focusCell(rowIndex + 1, columnIndex);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      onMoveColumn(columnIndex, -1);
      focusCell(rowIndex, columnIndex - 1);
      return;
    }
    if (primary && event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      onMoveColumn(columnIndex, 1);
      focusCell(rowIndex, columnIndex + 1);
    }
  }

  function handleCellPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
    columnIndex: number,
  ) {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n") && !text.includes("\r")) return;
    event.preventDefault();
    const matrix = tableClipboardMatrix(text);
    onPasteCells(rowIndex, columnIndex, matrix);
    const lastRow = rowIndex + Math.max(0, matrix.length - 1);
    const lastColumn =
      columnIndex + Math.max(0, Math.max(...matrix.map((row) => row.length)) - 1);
    focusCell(lastRow, lastColumn);
  }

  return (
    <div
      ref={tableRef}
      tabIndex={0}
      data-docx-block={block.id}
      className={cn(
        "mb-4 rounded-sm p-1",
        active && "ring-1 ring-[var(--accent)]/30",
      )}
      onFocus={onFocus}
    >
      <DocxTableActionToolbar
        block={block}
        canMergeDown={canMergeDown}
        canMergeRight={canMergeRight}
        canSplitCell={canSplitCell}
        columns={columns}
        normalizedRowCount={normalizedRows.length}
        selectedCell={selectedCell}
        tableBorderColor={tableBorderColor}
        tableBorderSize={tableBorderSize}
        tableCellBackground={tableCellBackground}
        tableCellVerticalAlign={tableCellVerticalAlign}
        tableHeaderBackground={tableHeaderBackground}
        onAddColumn={onAddColumn}
        onAddRow={onAddRow}
        onClearCell={onClearCell}
        onDeleteColumn={onDeleteColumn}
        onDeleteRow={onDeleteRow}
        onDuplicateColumn={onDuplicateColumn}
        onDuplicateRow={onDuplicateRow}
        onInsertColumn={onInsertColumn}
        onInsertRow={onInsertRow}
        onMergeCellDown={onMergeCellDown}
        onMergeCellRight={onMergeCellRight}
        onMoveColumn={onMoveColumn}
        onMoveRow={onMoveRow}
        onSplitCell={onSplitCell}
        onStyleChange={onStyleChange}
      />
      <table
        className="border-collapse text-sm"
        style={{ width: twipsToCssPixels(tableWidth) }}
      >
        <colgroup>
          {columnWidths.map((width, columnIndex) => (
            <col
              key={columnIndex}
              style={{
                width: twipsToCssPixels(width),
                minWidth: twipsToCssPixels(width),
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="w-8 border border-neutral-300 bg-neutral-50" />
            {Array.from({ length: columns }, (_, columnIndex) => (
              <th
                key={columnIndex}
                className={cn(
                  "group relative border border-neutral-300 bg-neutral-50 px-1 py-1 text-center text-[11px] font-medium text-neutral-500",
                  selectedCell?.column === columnIndex && "bg-lime-50 text-lime-700",
                )}
                style={{
                  width: twipsToCssPixels(columnWidths[columnIndex]),
                  minWidth: twipsToCssPixels(columnWidths[columnIndex]),
                  borderColor: tableBorderColor,
                }}
              >
                <button
                  type="button"
                  onClick={() => focusCell(selectedCell?.row ?? 0, columnIndex)}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-neutral-100"
                  title="Select column"
                >
                  {columnName(columnIndex)}
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => startColumnResize(event, columnIndex)}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize opacity-0 hover:bg-lime-300/50 group-hover:opacity-100"
                  title="Resize column"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              style={{
                height: twipsToCssPixels(rowHeights[rowIndex]),
              }}
            >
              <th
                className={cn(
                  "group relative border border-neutral-300 bg-neutral-50 px-1 py-1 text-[11px] font-medium text-neutral-500",
                  selectedCell?.row === rowIndex && "bg-lime-50 text-lime-700",
                )}
                style={{
                  height: twipsToCssPixels(rowHeights[rowIndex]),
                  minHeight: twipsToCssPixels(rowHeights[rowIndex]),
                  borderColor: tableBorderColor,
                }}
              >
                <button
                  type="button"
                  onClick={() => focusCell(rowIndex, selectedCell?.column ?? 0)}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-neutral-100"
                  title="Select row"
                >
                  {rowIndex + 1}
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => startRowResize(event, rowIndex)}
                  className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize opacity-0 hover:bg-lime-300/50 group-hover:opacity-100"
                  title="Resize row"
                />
              </th>
              {row.map((cell, columnIndex) => {
                if (isDocxTableCellCovered(block, rowIndex, columnIndex)) {
                  return null;
                }
                const mergedRange = mergedRangeForCell(block, rowIndex, columnIndex);
                return (
                  <td
                    key={columnIndex}
                    rowSpan={mergedRange?.rowSpan}
                    colSpan={mergedRange?.colSpan}
                    className={cn(
                      "border border-neutral-300 p-0",
                      selectedCell?.row === rowIndex &&
                        selectedCell.column === columnIndex &&
                        "bg-lime-50",
                    )}
                    style={{
                      backgroundColor:
                        block.tableHeaderRow === true && rowIndex === 0
                          ? tableHeaderBackground
                          : tableCellBackground,
                      borderColor: tableBorderColor,
                      borderWidth: Math.max(0, Math.ceil(tableBorderSize / 2)),
                      verticalAlign:
                        tableCellVerticalAlign === "center"
                          ? "middle"
                          : tableCellVerticalAlign,
                    }}
                  >
                    <textarea
                      value={cell}
                      data-docx-cell={`${rowIndex}:${columnIndex}`}
                      onFocus={() => selectCell(rowIndex, columnIndex)}
                      onKeyDown={(event) =>
                        handleCellKeyDown(event, rowIndex, columnIndex)
                      }
                      onPaste={(event) =>
                        handleCellPaste(event, rowIndex, columnIndex)
                      }
                      onChange={(event) =>
                        onCellChange(rowIndex, columnIndex, event.target.value)
                      }
                      className="min-h-10 w-full resize-y bg-transparent px-2 py-1 text-sm leading-5 outline-none focus:bg-white"
                      style={{
                        minHeight: twipsToCssPixels(rowHeights[rowIndex]),
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
