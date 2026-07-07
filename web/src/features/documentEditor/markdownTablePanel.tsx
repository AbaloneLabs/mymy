import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  MarkdownTableAlignment,
  MarkdownTableModel,
} from "./markdownEditorUtils";
import { markdownTextButtonClass } from "./markdownEditorChrome";

export function MarkdownTablePanel({
  table,
  onCreate,
  onHeaderChange,
  onAlignmentChange,
  onCellChange,
  onAddRow,
  onDuplicateRow,
  onMoveRow,
  onDeleteRow,
  onAddColumn,
  onDuplicateColumn,
  onMoveColumn,
  onDeleteColumn,
}: {
  table: MarkdownTableModel | null;
  onCreate: () => void;
  onHeaderChange: (columnIndex: number, value: string) => void;
  onAlignmentChange: (
    columnIndex: number,
    alignment: MarkdownTableAlignment,
  ) => void;
  onCellChange: (rowIndex: number, columnIndex: number, value: string) => void;
  onAddRow: (afterRowIndex?: number) => void;
  onDuplicateRow: (rowIndex: number) => void;
  onMoveRow: (rowIndex: number, direction: -1 | 1) => void;
  onDeleteRow: (rowIndex: number) => void;
  onAddColumn: (afterColumnIndex?: number) => void;
  onDuplicateColumn: (columnIndex: number) => void;
  onMoveColumn: (columnIndex: number, direction: -1 | 1) => void;
  onDeleteColumn: (columnIndex: number) => void;
}) {
  if (!table) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-sm text-[var(--accent)] hover:bg-[var(--surface-hover)]"
        >
          Insert table
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] p-2">
        <button type="button" onClick={() => onAddRow()} className={markdownTextButtonClass()}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Row
        </button>
        <button
          type="button"
          onClick={() => onAddColumn()}
          className={markdownTextButtonClass()}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Column
        </button>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-faint)]">
          L{table.startLine}-{table.endLine}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-20 border border-[var(--border)] bg-[var(--surface)]" />
              {table.headers.map((header, columnIndex) => (
                <th
                  key={columnIndex}
                  className="sticky top-0 z-10 min-w-44 border border-[var(--border)] bg-[var(--surface)] p-1 align-top"
                >
                  <div className="grid gap-1">
                    <input
                      value={header}
                      onChange={(event) =>
                        onHeaderChange(columnIndex, event.target.value)
                      }
                      className="h-8 min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    <div className="flex items-center gap-1">
                      <select
                        value={table.alignments[columnIndex] ?? "default"}
                        onChange={(event) =>
                          onAlignmentChange(
                            columnIndex,
                            event.target.value as MarkdownTableAlignment,
                          )
                        }
                        className="h-7 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      >
                        <option value="default">Default</option>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                      <MarkdownIconButton
                        icon={ArrowLeft}
                        label="Move column left"
                        disabled={columnIndex === 0}
                        onClick={() => onMoveColumn(columnIndex, -1)}
                      />
                      <MarkdownIconButton
                        icon={ArrowRight}
                        label="Move column right"
                        disabled={columnIndex === table.headers.length - 1}
                        onClick={() => onMoveColumn(columnIndex, 1)}
                      />
                      <MarkdownIconButton
                        icon={Copy}
                        label="Duplicate column"
                        onClick={() => onDuplicateColumn(columnIndex)}
                      />
                      <MarkdownIconButton
                        icon={Trash2}
                        label="Delete column"
                        danger
                        disabled={table.headers.length <= 1}
                        onClick={() => onDeleteColumn(columnIndex)}
                      />
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] p-1 align-top">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="min-w-5 text-right font-mono text-[10px] text-[var(--text-faint)]">
                      {rowIndex + 1}
                    </span>
                    <MarkdownIconButton
                      icon={ArrowUp}
                      label="Move row up"
                      disabled={rowIndex === 0}
                      onClick={() => onMoveRow(rowIndex, -1)}
                    />
                    <MarkdownIconButton
                      icon={ArrowDown}
                      label="Move row down"
                      disabled={rowIndex === table.rows.length - 1}
                      onClick={() => onMoveRow(rowIndex, 1)}
                    />
                    <MarkdownIconButton
                      icon={Plus}
                      label="Insert row below"
                      onClick={() => onAddRow(rowIndex)}
                    />
                    <MarkdownIconButton
                      icon={Copy}
                      label="Duplicate row"
                      onClick={() => onDuplicateRow(rowIndex)}
                    />
                    <MarkdownIconButton
                      icon={Trash2}
                      label="Delete row"
                      danger
                      onClick={() => onDeleteRow(rowIndex)}
                    />
                  </div>
                </th>
                {table.headers.map((_header, columnIndex) => (
                  <td key={columnIndex} className="border border-[var(--border)] p-0">
                    <textarea
                      value={row[columnIndex] ?? ""}
                      onChange={(event) =>
                        onCellChange(rowIndex, columnIndex, event.target.value)
                      }
                      className="h-16 min-w-44 resize-y bg-[var(--bg)] px-2 py-1 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.headers.length + 1}
                  className="border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-faint)]"
                >
                  Empty table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarkdownIconButton({
  icon: Icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40",
        danger && "hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]",
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
