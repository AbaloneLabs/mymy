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
import type { DocxBlock } from "../shared/models";
import { DOCX_TABLE_STYLES } from "./docxEditorUtils";

interface DocxTableActionToolbarProps {
  block: DocxBlock;
  canMergeDown: boolean;
  canMergeRight: boolean;
  canSplitCell: boolean;
  columns: number;
  normalizedRowCount: number;
  selectedCell: { row: number; column: number } | null;
  tableBorderColor: string;
  tableBorderSize: number;
  tableCellBackground: string;
  tableCellVerticalAlign: NonNullable<DocxBlock["tableCellVerticalAlign"]>;
  tableHeaderBackground: string;
  onAddColumn: () => void;
  onAddRow: () => void;
  onClearCell: (row: number, column: number) => void;
  onDeleteColumn: (column: number) => void;
  onDeleteRow: (row: number) => void;
  onDuplicateColumn: (column: number) => void;
  onDuplicateRow: (row: number) => void;
  onInsertColumn: (column: number, position: "left" | "right") => void;
  onInsertRow: (row: number, position: "above" | "below") => void;
  onMergeCellDown: (row: number, column: number) => void;
  onMergeCellRight: (row: number, column: number) => void;
  onMoveColumn: (column: number, direction: -1 | 1) => void;
  onMoveRow: (row: number, direction: -1 | 1) => void;
  onSplitCell: (row: number, column: number) => void;
  onStyleChange: (patch: Partial<DocxBlock>) => void;
}

export function DocxTableActionToolbar({
  block,
  canMergeDown,
  canMergeRight,
  canSplitCell,
  columns,
  normalizedRowCount,
  selectedCell,
  tableBorderColor,
  tableBorderSize,
  tableCellBackground,
  tableCellVerticalAlign,
  tableHeaderBackground,
  onAddColumn,
  onAddRow,
  onClearCell,
  onDeleteColumn,
  onDeleteRow,
  onDuplicateColumn,
  onDuplicateRow,
  onInsertColumn,
  onInsertRow,
  onMergeCellDown,
  onMergeCellRight,
  onMoveColumn,
  onMoveRow,
  onSplitCell,
  onStyleChange,
}: DocxTableActionToolbarProps) {
  const rowActionDisabled = !selectedCell;
  const columnActionDisabled = !selectedCell;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1">
      <span className="px-1 text-[11px] font-medium text-neutral-500">Row</span>
      <DocxTableActionButton icon={ArrowUp} label="Insert row above" onClick={() => selectedCell && onInsertRow(selectedCell.row, "above")} disabled={rowActionDisabled} />
      <DocxTableActionButton icon={ArrowDown} label="Insert row below" onClick={() => selectedCell ? onInsertRow(selectedCell.row, "below") : onAddRow()} />
      <DocxTableActionButton icon={Copy} label="Duplicate row" onClick={() => selectedCell && onDuplicateRow(selectedCell.row)} disabled={rowActionDisabled} />
      <DocxTableActionButton icon={ChevronUp} label="Move row up" onClick={() => selectedCell && onMoveRow(selectedCell.row, -1)} disabled={!selectedCell || selectedCell.row <= 0} />
      <DocxTableActionButton icon={ChevronDown} label="Move row down" onClick={() => selectedCell && onMoveRow(selectedCell.row, 1)} disabled={!selectedCell || selectedCell.row >= normalizedRowCount - 1} />
      <DocxTableActionButton icon={Trash2} label="Delete row" onClick={() => selectedCell && onDeleteRow(selectedCell.row)} disabled={!selectedCell || normalizedRowCount <= 1} danger />
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
