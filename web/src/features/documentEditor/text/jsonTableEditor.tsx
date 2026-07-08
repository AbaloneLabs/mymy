import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  JsonDeleteButton,
  JsonDragHandle,
  JsonIconButton,
} from "./textJsonEditorControls";
import { startJsonDataDrag } from "./textJsonEditorControlUtils";
import {
  cloneJsonValue,
  jsonCellToString,
  parseJsonCell,
  parseJsonContent,
  tabularJsonModel,
} from "./textJsonUtils";
import type { JsonTableRow } from "./textJsonUtils";

export function JsonTableEditor({
  content,
  onChangeContent,
}: {
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const [newColumnKey, setNewColumnKey] = useState("");
  const [newRowKey, setNewRowKey] = useState("");
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [columnDropKey, setColumnDropKey] = useState<string | null>(null);
  const [draggedRowIndex, setDraggedRowIndex] = useState<number | null>(null);
  const [rowDropIndex, setRowDropIndex] = useState<number | null>(null);
  const parsed = parseJsonContent(content);
  const table = tabularJsonModel(parsed);
  if (!table) {
    return (
      <div className="h-full overflow-auto p-4 text-sm text-[var(--text-muted)]">
        JSON table mode requires a root array of objects or an object whose
        values are objects.
      </div>
    );
  }
  const tableModel = table;
  const { rows, columns } = tableModel;
  const cleanNewColumnKey = newColumnKey.trim();
  const cleanNewRowKey = newRowKey.trim();
  const canAddColumn = Boolean(cleanNewColumnKey && !columns.includes(cleanNewColumnKey));
  const existingRowKeys = new Set(rows.map((row) => row.key).filter(Boolean));
  const canUseRowKey =
    tableModel.kind === "array" ||
    Boolean(cleanNewRowKey && !existingRowKeys.has(cleanNewRowKey));

  function updateRows(nextRows: JsonTableRow[]) {
    if (tableModel.kind === "array") {
      onChangeContent(`${JSON.stringify(nextRows.map((row) => row.value), null, 2)}\n`);
      return;
    }
    onChangeContent(
      `${JSON.stringify(
        Object.fromEntries(
          nextRows
            .filter((row) => row.key?.trim())
            .map((row) => [row.key?.trim() ?? "", row.value]),
        ),
        null,
        2,
      )}\n`,
    );
  }

  function updateCell(rowIndex: number, key: string, value: string) {
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex
          ? {
              ...row,
              value: {
                ...row.value,
                [key]: parseJsonCell(value, row.value[key]),
              },
            }
          : row,
      ),
    );
  }

  function renameRowKey(rowIndex: number, nextKey: string) {
    const cleanKey = nextKey.trim();
    if (tableModel.kind !== "object" || !cleanKey) return;
    if (rows.some((row, index) => index !== rowIndex && row.key === cleanKey)) return;
    updateRows(
      rows.map((row, currentIndex) =>
        currentIndex === rowIndex ? { ...row, key: cleanKey } : row,
      ),
    );
  }

  function renameColumn(currentKey: string, nextKey: string) {
    if (!nextKey.trim() || currentKey === nextKey) return;
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row.value)) {
          next[key === currentKey ? nextKey : key] = value;
        }
        if (!(currentKey in row.value)) next[nextKey] = "";
        return { ...row, value: next };
      }),
    );
  }

  function addColumn() {
    if (!canAddColumn) return;
    const nextKey = cleanNewColumnKey;
    updateRows(rows.map((row) => ({ ...row, value: { ...row.value, [nextKey]: "" } })));
    setNewColumnKey("");
  }

  function duplicateColumn(key: string) {
    if (!canAddColumn) return;
    const nextKey = cleanNewColumnKey;
    updateRows(
      rows.map((row) => ({
        ...row,
        value: { ...row.value, [nextKey]: cloneJsonValue(row.value[key]) },
      })),
    );
    setNewColumnKey("");
  }

  function moveColumn(key: string, direction: -1 | 1) {
    const index = columns.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= columns.length) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(index, 1);
    nextColumns.splice(nextIndex, 0, moved);
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        nextColumns.forEach((column) => {
          next[column] = row.value[column];
        });
        return { ...row, value: next };
      }),
    );
  }

  function reorderColumn(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const fromIndex = columns.indexOf(fromKey);
    const toIndex = columns.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    nextColumns.splice(toIndex, 0, moved);
    updateRows(
      rows.map((row) => {
        const next: Record<string, unknown> = {};
        nextColumns.forEach((column) => {
          next[column] = row.value[column];
        });
        return { ...row, value: next };
      }),
    );
  }

  function deleteColumn(key: string) {
    updateRows(
      rows.map((row) => {
        const next = { ...row.value };
        delete next[key];
        return { ...row, value: next };
      }),
    );
  }

  function addRow() {
    if (!canUseRowKey) return;
    const emptyValue = Object.fromEntries(columns.map((column) => [column, ""]));
    updateRows([
      ...rows,
      {
        key: tableModel.kind === "object" ? cleanNewRowKey : undefined,
        value: emptyValue,
      },
    ]);
    setNewRowKey("");
  }

  function duplicateRow(index: number) {
    if (!canUseRowKey) return;
    updateRows([
      ...rows.slice(0, index + 1),
      {
        key: tableModel.kind === "object" ? cleanNewRowKey : undefined,
        value: cloneJsonValue(rows[index]?.value ?? {}) as Record<string, unknown>,
      },
      ...rows.slice(index + 1),
    ]);
    setNewRowKey("");
  }

  function moveRow(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    reorderRow(index, nextIndex);
  }

  function reorderRow(index: number, nextIndex: number) {
    if (index === nextIndex || index < 0 || nextIndex < 0) return;
    if (index >= rows.length || nextIndex >= rows.length) return;
    const nextRows = [...rows];
    const [moved] = nextRows.splice(index, 1);
    nextRows.splice(nextIndex, 0, moved);
    updateRows(nextRows);
  }

  function deleteRow(index: number) {
    updateRows(rows.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {tableModel.kind === "object" && (
          <input
            value={newRowKey}
            onChange={(event) => setNewRowKey(event.target.value)}
            placeholder="Row key"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <button
          type="button"
          onClick={addRow}
          disabled={!canUseRowKey}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add row
        </button>
        <input
          value={newColumnKey}
          onChange={(event) => setNewColumnKey(event.target.value)}
          placeholder="Column key"
          className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={addColumn}
          disabled={!canAddColumn}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add column
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-collapse text-xs shadow-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-12 border border-[var(--border)] bg-[var(--surface)]" />
              {tableModel.kind === "object" && (
                <th className="sticky top-0 z-10 min-w-36 border border-[var(--border)] bg-[var(--surface)] p-1 font-mono text-[var(--text-muted)]">
                  key
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column}
                  onDragOver={(event) => {
                    if (draggedColumnKey === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setColumnDropKey(column);
                  }}
                  onDragLeave={(event) => {
                    event.stopPropagation();
                    setColumnDropKey((current) => (current === column ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (draggedColumnKey !== null) reorderColumn(draggedColumnKey, column);
                    setDraggedColumnKey(null);
                    setColumnDropKey(null);
                  }}
                  className={cn(
                    "sticky top-0 z-10 min-w-40 border border-[var(--border)] bg-[var(--surface)] p-1",
                    columnDropKey === column && "bg-[var(--accent)]/10",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <JsonDragHandle
                      label="Drag column"
                      onDragStart={(event) => {
                        setDraggedColumnKey(column);
                        startJsonDataDrag(event, `column:${column}`);
                      }}
                      onDragEnd={() => {
                        setDraggedColumnKey(null);
                        setColumnDropKey(null);
                      }}
                    />
                    <input
                      value={column}
                      onChange={(event) => renameColumn(column, event.target.value)}
                      className="min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none"
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === 0}
                      icon={ArrowLeft}
                      label="Move column left"
                      onClick={() => moveColumn(column, -1)}
                    />
                    <JsonIconButton
                      disabled={columns.indexOf(column) === columns.length - 1}
                      icon={ArrowRight}
                      label="Move column right"
                      onClick={() => moveColumn(column, 1)}
                    />
                    <JsonIconButton
                      disabled={!canAddColumn}
                      icon={Copy}
                      label="Duplicate column"
                      onClick={() => duplicateColumn(column)}
                    />
                    <JsonDeleteButton onClick={() => deleteColumn(column)} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onDragOver={(event) => {
                  if (draggedRowIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setRowDropIndex(rowIndex);
                }}
                onDragLeave={(event) => {
                  event.stopPropagation();
                  setRowDropIndex((current) => (current === rowIndex ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedRowIndex !== null) reorderRow(draggedRowIndex, rowIndex);
                  setDraggedRowIndex(null);
                  setRowDropIndex(null);
                }}
                className={cn(rowDropIndex === rowIndex && "bg-[var(--accent)]/10")}
              >
                <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-2 text-[var(--text-faint)]">
                  <div className="flex items-center gap-1">
                    <JsonDragHandle
                      label="Drag row"
                      onDragStart={(event) => {
                        setDraggedRowIndex(rowIndex);
                        startJsonDataDrag(event, `row:${rowIndex}`);
                      }}
                      onDragEnd={() => {
                        setDraggedRowIndex(null);
                        setRowDropIndex(null);
                      }}
                    />
                    <span className="min-w-6 text-right">{rowIndex + 1}</span>
                    <JsonIconButton
                      disabled={rowIndex === 0}
                      icon={ArrowUp}
                      label="Move row up"
                      onClick={() => moveRow(rowIndex, -1)}
                    />
                    <JsonIconButton
                      disabled={rowIndex === rows.length - 1}
                      icon={ArrowDown}
                      label="Move row down"
                      onClick={() => moveRow(rowIndex, 1)}
                    />
                    <JsonIconButton
                      disabled={!canUseRowKey}
                      icon={Copy}
                      label="Duplicate row"
                      onClick={() => duplicateRow(rowIndex)}
                    />
                    <JsonDeleteButton onClick={() => deleteRow(rowIndex)} />
                  </div>
                </th>
                {tableModel.kind === "object" && (
                  <td className="border border-[var(--border)] p-0">
                    <input
                      value={row.key ?? ""}
                      onChange={(event) => renameRowKey(rowIndex, event.target.value)}
                      className="h-8 min-w-36 bg-[var(--bg)] px-2 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column} className="border border-[var(--border)] p-0">
                    <input
                      value={jsonCellToString(row.value[column])}
                      onChange={(event) =>
                        updateCell(rowIndex, column, event.target.value)
                      }
                      className="h-8 min-w-40 bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, columns.length + (tableModel.kind === "object" ? 2 : 1))}
                  className="border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]"
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
