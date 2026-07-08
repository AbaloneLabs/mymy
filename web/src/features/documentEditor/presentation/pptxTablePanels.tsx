import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useState } from "react";
import { Move, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PptxTable, PptxTableCellStyle } from "../shared/models";
import { pptxTableStyle } from "./pptxEditorUtils";

export function PptxEditableTable({
  table,
  selected,
  zIndex,
  onSelect,
  onStartMove,
  onStartResize,
  onKeyDown,
  onCellChange,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onDeleteColumn,
  onColumnWidthChange,
  onRowHeightChange,
  onCellStyleChange,
}: {
  table: PptxTable;
  selected: boolean;
  zIndex: number;
  onSelect: (event?: ReactPointerEvent<HTMLElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCellChange: (rowIndex: number, columnIndex: number, value: string) => void;
  onAddRow: (rowIndex: number) => void;
  onAddColumn: (columnIndex: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onDeleteColumn: (columnIndex: number) => void;
  onColumnWidthChange: (columnIndex: number, value: number) => void;
  onRowHeightChange: (rowIndex: number, value: number) => void;
  onCellStyleChange: (
    rowIndex: number,
    columnIndex: number,
    patch: Partial<PptxTableCellStyle>,
  ) => void;
}) {
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  const canDeleteRow = table.rows.length > 1;
  const canDeleteColumn = columnCount > 1;
  const activeColumnWidth =
    table.columnWidths?.[activeCell.column] ?? 100 / Math.max(columnCount, 1);
  const activeRowHeight =
    table.rowHeights?.[activeCell.row] ?? 100 / Math.max(table.rows.length, 1);
  const activeCellStyle = pptxTableCellStyleAt(
    table,
    activeCell.row,
    activeCell.column,
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "absolute border border-neutral-400 bg-white text-neutral-950 shadow-sm outline-none",
        selected && "ring-2 ring-[var(--accent)]/40",
      )}
      style={pptxTableStyle(table, zIndex)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        onKeyDown(event);
      }}
    >
      {selected && (
        <div className="absolute -top-9 right-0 z-30 flex items-center gap-1 rounded-md border border-neutral-300 bg-white p-1 text-[10px] text-neutral-600 shadow-sm">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddRow(activeCell.row);
            }}
            className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 hover:bg-neutral-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Row
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddColumn(activeCell.column);
            }}
            className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1.5 hover:bg-neutral-100"
          >
            <Plus className="h-3 w-3" strokeWidth={1.75} />
            Col
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteRow(activeCell.row);
              setActiveCell((current) => ({
                ...current,
                row: Math.max(0, current.row - 1),
              }));
            }}
            disabled={!canDeleteRow}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete row"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteColumn(activeCell.column);
              setActiveCell((current) => ({
                ...current,
                column: Math.max(0, current.column - 1),
              }));
            }}
            disabled={!canDeleteColumn}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete column"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <label className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1 text-[10px]">
            W
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(activeColumnWidth)}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                onColumnWidthChange(
                  activeCell.column,
                  Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)),
                )
              }
              className="h-4 w-10 bg-transparent outline-none"
            />
          </label>
          <label className="inline-flex h-6 items-center gap-1 rounded border border-neutral-200 px-1 text-[10px]">
            H
            <input
              type="number"
              min={1}
              max={100}
              value={Math.round(activeRowHeight)}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                onRowHeightChange(
                  activeCell.row,
                  Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)),
                )
              }
              className="h-4 w-10 bg-transparent outline-none"
            />
          </label>
          <input
            type="color"
            value={activeCellStyle.fillColor ?? "#ffffff"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                fillColor: event.currentTarget.value,
              })
            }
            className="h-5 w-6 cursor-pointer bg-transparent"
            title="Cell fill"
          />
          <input
            type="color"
            value={activeCellStyle.textColor ?? "#111827"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                textColor: event.currentTarget.value,
              })
            }
            className="h-5 w-6 cursor-pointer bg-transparent"
            title="Text color"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCellStyleChange(activeCell.row, activeCell.column, {
                bold: !activeCellStyle.bold,
              });
            }}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 font-semibold",
              activeCellStyle.bold && "bg-blue-50 text-blue-700",
            )}
            title="Bold cell"
          >
            B
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCellStyleChange(activeCell.row, activeCell.column, {
                italic: !activeCellStyle.italic,
              });
            }}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded border border-neutral-200 italic",
              activeCellStyle.italic && "bg-blue-50 text-blue-700",
            )}
            title="Italic cell"
          >
            I
          </button>
          <select
            value={activeCellStyle.align ?? "left"}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onCellStyleChange(activeCell.row, activeCell.column, {
                align: event.currentTarget.value as PptxTableCellStyle["align"],
              })
            }
            className="h-6 rounded border border-neutral-200 bg-white px-1 text-[10px]"
            title="Cell alignment"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      )}
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <PptxTableColumnGroup table={table} />
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={pptxTableRowStyle(table, rowIndex)}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={pptxTableCellClassName(
                    table,
                    rowIndex,
                    columnIndex,
                    "p-0",
                  )}
                  style={pptxTableCellStyle(table, rowIndex, columnIndex)}
                >
                  <textarea
                    value={cell}
                    onFocus={() => {
                      onSelect();
                      setActiveCell({ row: rowIndex, column: columnIndex });
                    }}
                    onClick={() =>
                      setActiveCell({ row: rowIndex, column: columnIndex })
                    }
                    onChange={(event) =>
                      onCellChange(rowIndex, columnIndex, event.target.value)
                    }
                    style={pptxTableCellTextStyle(table, rowIndex, columnIndex)}
                    className="h-full min-h-8 w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-4 outline-none focus:bg-blue-50"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <button
          type="button"
          onPointerDown={onStartMove}
          className="absolute -top-7 left-0 inline-flex h-6 items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 text-[10px] text-neutral-600 shadow-sm"
          title="Move table"
        >
          <Move className="h-3 w-3" strokeWidth={1.75} />
          Move
        </button>
      )}
      {selected && (
        <button
          type="button"
          onPointerDown={onStartResize}
          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-[var(--accent)] bg-white shadow-sm"
          title="Resize table"
        />
      )}
    </div>
  );
}

export function PptxTableView({
  table,
  zIndex,
}: {
  table: PptxTable;
  zIndex: number;
}) {
  return (
    <div
      className="absolute overflow-hidden border border-neutral-400 bg-white text-neutral-950"
      style={pptxTableStyle(table, zIndex)}
    >
      <table className="h-full w-full table-fixed border-collapse text-xs">
        <PptxTableColumnGroup table={table} />
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={pptxTableRowStyle(table, rowIndex)}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={pptxTableCellClassName(
                    table,
                    rowIndex,
                    columnIndex,
                    "whitespace-pre-wrap px-1 py-0.5 align-top",
                  )}
                  style={{
                    ...pptxTableCellStyle(table, rowIndex, columnIndex),
                    ...pptxTableCellTextStyle(table, rowIndex, columnIndex),
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pptxTableCellClassName(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
  extraClassName: string,
) {
  const rowCount = table.rows.length;
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  const header = table.firstRow !== false && rowIndex === 0;
  const total = table.lastRow && rowIndex === rowCount - 1;
  const firstColumn = table.firstColumn && columnIndex === 0;
  const lastColumn = table.lastColumn && columnIndex === columnCount - 1;
  const bandedRow =
    table.bandedRows !== false && rowIndex > 0 && !total && rowIndex % 2 === 1;
  const bandedColumn =
    table.bandedColumns && columnIndex > 0 && !lastColumn && columnIndex % 2 === 1;
  return cn(
    "border border-neutral-300",
    (header || total) && "bg-blue-100 font-semibold text-blue-950",
    !header && !total && bandedRow && "bg-neutral-50",
    !header && !total && bandedColumn && "bg-sky-50",
    (firstColumn || lastColumn) && "font-semibold",
    extraClassName,
  );
}

function pptxTableCellStyleAt(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): PptxTableCellStyle {
  return table.cellStyles?.[rowIndex]?.[columnIndex] ?? {};
}

function pptxTableCellStyle(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): CSSProperties {
  const style = pptxTableCellStyleAt(table, rowIndex, columnIndex);
  return style.fillColor ? { backgroundColor: style.fillColor } : {};
}

function pptxTableCellTextStyle(
  table: PptxTable,
  rowIndex: number,
  columnIndex: number,
): CSSProperties {
  const style = pptxTableCellStyleAt(table, rowIndex, columnIndex);
  return {
    color: style.textColor,
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textAlign: style.align,
  };
}

function PptxTableColumnGroup({ table }: { table: PptxTable }) {
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  if (columnCount === 0) return null;
  return (
    <colgroup>
      {Array.from({ length: columnCount }, (_, columnIndex) => (
        <col
          key={columnIndex}
          style={{
            width: `${table.columnWidths?.[columnIndex] ?? 100 / columnCount}%`,
          }}
        />
      ))}
    </colgroup>
  );
}

function pptxTableRowStyle(table: PptxTable, rowIndex: number) {
  if (!table.rowHeights?.[rowIndex]) return undefined;
  return { height: `${table.rowHeights[rowIndex]}%` };
}
