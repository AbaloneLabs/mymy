import { useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Palette,
  Plus,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { columnName } from "./models";
import type { DocxBlock, DocxPageSettings } from "./models";
import {
  DEFAULT_DOCX_TABLE_BACKGROUND,
  DEFAULT_DOCX_TABLE_BORDER_COLOR,
  DEFAULT_DOCX_TABLE_BORDER_SIZE,
  DEFAULT_DOCX_TABLE_HEADER_BACKGROUND,
  DOCX_TABLE_STYLES,
  DOCX_PAGE_PRESETS,
  TWIPS_PER_INCH,
  clampTableCell,
  inchesToTwips,
  MIN_DOCX_TABLE_COLUMN_WIDTH,
  MIN_DOCX_TABLE_ROW_HEIGHT,
  normalizeDocxTableColumnWidths,
  normalizeDocxTableRowHeights,
  normalizeDocxTableRow,
  tableClipboardMatrix,
  tableColumnCount,
  twipsToCssPixels,
  twipsToInches,
} from "./docxEditorUtils";
import {
  isDocxTableCellCovered,
  mergedRangeForCell,
} from "./docxTableOperations";

export { DocxImageBlock } from "./docxImageBlock";
export { DocxTextPartsPanel } from "./docxTextPartsPanel";

export function DocxRuler({
  page,
  onChange,
}: {
  page: DocxPageSettings | undefined;
  onChange: (patch: Partial<DocxPageSettings>) => void;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const pageWidth = twipsToCssPixels(page?.width ?? DOCX_PAGE_PRESETS[0].width);
  const marginLeft = page?.marginLeft ?? TWIPS_PER_INCH;
  const marginRight = page?.marginRight ?? TWIPS_PER_INCH;
  const leftPercent = Math.min(100, Math.max(0, (marginLeft / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const rightPercent = Math.min(100, Math.max(0, 100 - (marginRight / (page?.width ?? DOCX_PAGE_PRESETS[0].width)) * 100));
  const ticks = Array.from({ length: Math.ceil(twipsToInches(page?.width ?? DOCX_PAGE_PRESETS[0].width)) + 1 }, (_, index) => index);

  function updateMarginFromPointer(
    event: ReactPointerEvent<HTMLButtonElement>,
    side: "left" | "right",
  ) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const pageWidthTwips = page?.width ?? DOCX_PAGE_PRESETS[0].width;
    const next = Math.round((x / rect.width) * pageWidthTwips);
    if (side === "left") {
      onChange({ marginLeft: Math.min(next, pageWidthTwips - marginRight - 720) });
    } else {
      onChange({ marginRight: Math.min(pageWidthTwips - next, pageWidthTwips - marginLeft - 720) });
    }
  }

  function startDrag(side: "left" | "right", event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMarginFromPointer(event, side);
  }

  return (
    <div
      ref={rulerRef}
      className="relative mx-auto mb-3 h-8 max-w-full border border-[var(--border)] bg-[var(--bg)] text-[10px] text-[var(--text-faint)]"
      style={{ width: pageWidth }}
    >
      <div
        className="absolute inset-y-0 bg-[var(--surface-muted)]"
        style={{ left: `${leftPercent}%`, right: `${100 - rightPercent}%` }}
      />
      {ticks.map((tick) => (
        <div
          key={tick}
          className="absolute bottom-0 top-0 border-l border-[var(--border)]"
          style={{ left: `${(tick / Math.max(1, ticks.length - 1)) * 100}%` }}
        >
          <span className="absolute left-1 top-0.5">{tick}</span>
        </div>
      ))}
      <button
        type="button"
        onPointerDown={(event) => startDrag("left", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "left");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${leftPercent}%` }}
        title="Left margin"
      />
      <button
        type="button"
        onPointerDown={(event) => startDrag("right", event)}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateMarginFromPointer(event, "right");
        }}
        className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize border border-[var(--accent)] bg-[var(--accent)]/20"
        style={{ left: `${rightPercent}%` }}
        title="Right margin"
      />
    </div>
  );
}

export function DocxMarginInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
      {label}
      <input
        type="number"
        min={0}
        max={4}
        step={0.1}
        value={twipsToInches(value ?? TWIPS_PER_INCH)}
        onChange={(event) => onChange(inchesToTwips(Number(event.target.value)))}
        className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
      />
    </label>
  );
}

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

  const rowActionDisabled = !selectedCell;
  const columnActionDisabled = !selectedCell;

  return (
    <div
      ref={tableRef}
      className={cn(
        "mb-4 rounded-sm p-1",
        active && "ring-1 ring-[var(--accent)]/30",
      )}
      onFocus={onFocus}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1">
        <span className="px-1 text-[11px] font-medium text-neutral-500">Row</span>
        <DocxTableActionButton icon={ArrowUp} label="Insert row above" onClick={() => selectedCell && onInsertRow(selectedCell.row, "above")} disabled={rowActionDisabled} />
        <DocxTableActionButton icon={ArrowDown} label="Insert row below" onClick={() => selectedCell ? onInsertRow(selectedCell.row, "below") : onAddRow()} />
        <DocxTableActionButton icon={Copy} label="Duplicate row" onClick={() => selectedCell && onDuplicateRow(selectedCell.row)} disabled={rowActionDisabled} />
        <DocxTableActionButton icon={ChevronUp} label="Move row up" onClick={() => selectedCell && onMoveRow(selectedCell.row, -1)} disabled={!selectedCell || selectedCell.row <= 0} />
        <DocxTableActionButton icon={ChevronDown} label="Move row down" onClick={() => selectedCell && onMoveRow(selectedCell.row, 1)} disabled={!selectedCell || selectedCell.row >= normalizedRows.length - 1} />
        <DocxTableActionButton icon={Trash2} label="Delete row" onClick={() => selectedCell && onDeleteRow(selectedCell.row)} disabled={!selectedCell || normalizedRows.length <= 1} danger />
        <div className="mx-1 h-5 w-px bg-neutral-200" />
        <span className="px-1 text-[11px] font-medium text-neutral-500">Column</span>
        <DocxTableActionButton icon={ArrowLeft} label="Insert column left" onClick={() => selectedCell && onInsertColumn(selectedCell.column, "left")} disabled={columnActionDisabled} />
        <DocxTableActionButton icon={ArrowRight} label="Insert column right" onClick={() => selectedCell ? onInsertColumn(selectedCell.column, "right") : onAddColumn()} />
        <DocxTableActionButton icon={Copy} label="Duplicate column" onClick={() => selectedCell && onDuplicateColumn(selectedCell.column)} disabled={columnActionDisabled} />
        <DocxTableActionButton icon={ArrowLeft} label="Move column left" onClick={() => selectedCell && onMoveColumn(selectedCell.column, -1)} disabled={!selectedCell || selectedCell.column <= 0} />
        <DocxTableActionButton icon={ArrowRight} label="Move column right" onClick={() => selectedCell && onMoveColumn(selectedCell.column, 1)} disabled={!selectedCell || selectedCell.column >= columns - 1} />
        <DocxTableActionButton icon={Trash2} label="Delete column" onClick={() => selectedCell && onDeleteColumn(selectedCell.column)} disabled={!selectedCell || columns <= 1} danger />
        <div className="mx-1 h-5 w-px bg-neutral-200" />
        <DocxTableActionButton icon={Eraser} label="Clear cell" onClick={() => selectedCell && onClearCell(selectedCell.row, selectedCell.column)} disabled={!selectedCell} />
        <DocxTableActionButton icon={TableCellsMerge} label="Merge right" onClick={() => selectedCell && onMergeCellRight(selectedCell.row, selectedCell.column)} disabled={!selectedCell || !canMergeRight} />
        <DocxTableActionButton icon={TableCellsMerge} label="Merge down" onClick={() => selectedCell && onMergeCellDown(selectedCell.row, selectedCell.column)} disabled={!selectedCell || !canMergeDown} />
        <DocxTableActionButton icon={TableCellsSplit} label="Split cell" onClick={() => selectedCell && onSplitCell(selectedCell.row, selectedCell.column)} disabled={!selectedCell || !canSplitCell} />
        <div className="mx-1 h-5 w-px bg-neutral-200" />
        <Palette className="h-3.5 w-3.5 text-neutral-500" strokeWidth={1.75} />
        <label className="inline-flex h-7 items-center gap-1 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-600">
          Header
          <input
            type="checkbox"
            checked={block.tableHeaderRow === true}
            onChange={(event) =>
              onStyleChange({ tableHeaderRow: event.target.checked })
            }
            className="h-3.5 w-3.5"
          />
        </label>
        <select
          value={block.tableStyle ?? ""}
          onChange={(event) =>
            onStyleChange({ tableStyle: event.target.value || undefined })
          }
          className="h-7 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-700 outline-none focus:border-[var(--accent)]"
          title="Table style"
        >
          {DOCX_TABLE_STYLES.map((style) => (
            <option key={style.label} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
        <label className="inline-flex h-7 items-center gap-1 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-600">
          Border
          <input
            type="color"
            value={tableBorderColor}
            onChange={(event) =>
              onStyleChange({ tableBorderColor: event.target.value })
            }
            className="h-4 w-5 border-0 bg-transparent p-0"
          />
          <input
            type="number"
            min={0}
            max={24}
            value={tableBorderSize}
            onChange={(event) => {
              const next = Number(event.target.value);
              onStyleChange({ tableBorderSize: Number.isFinite(next) ? next : 0 });
            }}
            className="w-10 bg-transparent text-right text-[11px] text-neutral-900 outline-none"
          />
        </label>
        <label className="inline-flex h-7 items-center gap-1 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-600">
          Fill
          <input
            type="color"
            value={tableCellBackground}
            onChange={(event) =>
              onStyleChange({ tableCellBackground: event.target.value })
            }
            className="h-4 w-5 border-0 bg-transparent p-0"
          />
        </label>
        <label className="inline-flex h-7 items-center gap-1 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-600">
          Head fill
          <input
            type="color"
            value={tableHeaderBackground}
            onChange={(event) =>
              onStyleChange({ tableHeaderBackground: event.target.value })
            }
            className="h-4 w-5 border-0 bg-transparent p-0"
          />
        </label>
        <select
          value={tableCellVerticalAlign}
          onChange={(event) =>
            onStyleChange({
              tableCellVerticalAlign: event.target
                .value as NonNullable<DocxBlock["tableCellVerticalAlign"]>,
            })
          }
          className="h-7 rounded border border-neutral-200 bg-white px-2 text-[11px] text-neutral-700 outline-none focus:border-[var(--accent)]"
          title="Cell vertical alignment"
        >
          <option value="top">Top</option>
          <option value="center">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </div>
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

function DocxTableActionButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-30",
        danger && "hover:bg-red-50 hover:text-red-600",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
